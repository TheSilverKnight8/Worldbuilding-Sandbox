import { seededRandom } from '../rng';
import type { Cliff } from '../world/types';
import { LINE, displace, type Pt } from './art/ink';
import { FALL } from './art/water';
import { borderLine, cornerKind, corners, cx, cy, edgeBetween, nearestCorner, pathBetween, type Corners } from './borders';
import { cellsNear, type Graph } from './graph';
import type { NoisyEdges } from './noisy';

// Cliffs (Caleb, after Stage 7: along the borders between polygons, like rivers, instead of
// icons). A cliff is a chain of polygon corners with the drop on the right of the line as it
// runs (seen on the map, north up). It is drawn along the same wiggly borders as the coasts.
// The map is seen from the south, so where the drop faces the viewer its rock face hangs
// straight down the page from the rim, and the less the drop faces the viewer, the less of
// the face shows; where the drop faces away only the rim shows (Caleb). The face hides what
// is behind it (rivers, the coast). The ground on the high side is raised by the drop.
// Where a river goes over a cliff, a waterfall appears; a river made by hand or by the
// generator that goes over one runs down the face (out of sight) and on the way the cliff
// faces for a while, so it leaves the waterfall's pool the way the water falls (Caleb).

/** The width a mountain is drawn at, in cell spacings (KINDS.mountain.size): it sets the line weights, so a cliff's lines match the icons'. */
const MOUNTAIN_SPACINGS = 5.5;

/** How tall a cliff's face is drawn, in map units: taller for a bigger drop, within limits. */
export function faceHeight(meters: number, spacing: number) {
  return spacing * Math.min(2.2, Math.max(0.5, 0.45 + 1.05 * Math.sqrt(Math.max(0, meters) / 300)));
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const smoothstep = (a: number, b: number, x: number) => smooth((x - a) / (b - a));

/** Whether a cliff is a ring (its first and last corners are the same). */
export const isRing = (c: Cliff) => c.vertices.length > 3 && c.vertices[0] === c.vertices[c.vertices.length - 1];

/** How a cliff's drop dies away toward its ends (none on a ring): 1 along most of it, 0 at an end; s along a line `length` long. */
function endsOf(length: number, ring: boolean, spacing: number) {
  const E = Math.min(spacing * 1.5, length / 3) || 1;
  return (s: number) => (ring ? 1 : smooth(s / E) * smooth((length - s) / E));
}

/** A line's points with how far along it each is. */
function runOf(pts: Pt[]) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}

/** Each segment's normal toward the drop (the right of the line as it runs, y down), and at each point the average of the segments beside it. */
function normalsOf(pts: Pt[], ring: boolean) {
  const seg: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dy) || 1;
    seg.push([-dy / len, dx / len]);
  }
  const at: Pt[] = pts.map((_, i) => {
    const a = seg[i - 1] ?? (ring ? seg[seg.length - 1] : undefined);
    const b = seg[i] ?? (ring ? seg[0] : undefined);
    const x = (a?.[0] ?? 0) + (b?.[0] ?? 0);
    const y = (a?.[1] ?? 0) + (b?.[1] ?? 0);
    const len = Math.hypot(x, y) || 1;
    return [x / len, y / len];
  });
  return { seg, at };
}

/** The cliff's corners as points. */
const cornerPts = (g: Graph, c: Cliff): Pt[] => c.vertices.map((v) => [cx(g, v), cy(g, v)]);

/**
 * The way a line faces at each of its points, smoothed over `window` along it either side (so
 * the small turns of the borders do not count): its normal toward the drop.
 */
function smoothNormals(pts: Pt[], run: number[], window: number, ring: boolean): Pt[] {
  const L = run[run.length - 1] || 1;
  const pointAt = (s: number): Pt => {
    s = ring ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
    let lo = 0;
    let hi = run.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (run[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - run[lo]) / (run[hi] - run[lo] || 1);
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  };
  return pts.map((_, i) => {
    const a = pointAt(run[i] - window);
    const b = pointAt(run[i] + window);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  });
}

/** How much of the face shows where the line faces this way: none where the drop faces away or sideways, all of it where it faces the viewer (south). */
const shows = (n: Pt) => smoothstep(0.1, 0.45, n[1]);

/** A cliff along its corners (straight from corner to corner): where they are, how far along, how it faces, and its face's height at each. */
function profileOf(g: Graph, c: Cliff) {
  const sp = g.spacing;
  const pts = cornerPts(g, c);
  const ring = isRing(c);
  const run = runOf(pts);
  const ends = endsOf(run[run.length - 1], ring, sp);
  const n = normalsOf(pts, ring);
  const facing = smoothNormals(pts, run, sp * 0.6, ring);
  const H = faceHeight(c.meters, sp);
  const face = pts.map((_, i) => H * ends(run[i]) * shows(facing[i]));
  return { pts, ring, run, ends, n, facing, H, face };
}

/** The nearest point of a line to (x, y): how far (d), on which side (v: signed, + toward the drop) and how far along it (s). */
function nearestOn(pts: Pt[], run: number[], n: { seg: Pt[]; at: Pt[] }, x: number, y: number) {
  let best = { d: Infinity, v: 0, s: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = Math.hypot(x - qx, y - qy);
    if (d >= best.d) continue;
    // Beside a segment, its own normal; off a corner, the corners' (so the side is right on both sides of a bend).
    const nn = t <= 0 ? n.at[i - 1] : t >= 1 ? n.at[i] : n.seg[i - 1];
    const side = (x - qx) * nn[0] + (y - qy) * nn[1];
    best = { d, v: side >= 0 ? d : -d, s: run[i - 1] + (run[i] - run[i - 1]) * t };
  }
  return best;
}

// ------------------------------------------------------------------ the ground

/**
 * Adds the cliffs' steps to the elevation `h` (meters per cell): the ground on the high side
 * of a cliff is higher by its drop, from the line to a few polygons back, dying away toward the
 * cliff's ends. Water cells are left alone.
 */
export function cliffSteps(g: Graph, land: Uint8Array, cliffs: Cliff[], h: Float32Array) {
  const sp = g.spacing;
  // The step across the line, between the polygons on either side of it; the high ground rises
  // to the drop a polygon back, then slopes gently down to the ground around it.
  const w = sp * 0.3;
  const full = sp * 1;
  const R = sp * 8;
  for (const c of cliffs) {
    if (c.vertices.length < 2) continue;
    const pts = cornerPts(g, c);
    const ring = isRing(c);
    const run = runOf(pts);
    const ends = endsOf(run[run.length - 1], ring, sp);
    const n = normalsOf(pts, ring);
    const seen = new Set<number>();
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      cellsNear(g, mx, my, run[i] - run[i - 1] + R, (cell) => {
        if (seen.has(cell) || !land[cell]) return;
        seen.add(cell);
        const near = nearestOn(pts, run, n, g.centers[cell * 2], g.centers[cell * 2 + 1]);
        if (near.d > R) return;
        // Just behind the rim the high ground tilts a little toward it, so water there goes over the edge.
        const tilt = 0.85 + 0.15 * smooth(near.d / full);
        h[cell] += c.meters * ends(near.s) * (1 - smoothstep(-w, w, near.v)) * tilt * (1 - smoothstep(full, R, near.d));
      });
    }
  }
}

// ------------------------------------------------------------------ rivers below cliffs

/** How far past the foot of a cliff's face (or past the rim, where the face is out of sight) a river made over it keeps on the way the cliff faces, in cell spacings. */
const BEYOND_FOOT = 1.2;

/**
 * What rivers made over the cliffs need: for each corner behind a cliff's face, or in the
 * stretch past its foot, that cliff (`zone`) and the way water goes from there (`dir`: down
 * the face, then the way the cliff faces); and for corners on a cliff's low side nearby, that
 * cliff (`low`). The cliffs' own corners are in none of them. -1 for none.
 */
export interface CliffZones {
  zone: Int32Array;
  dir: Float32Array;
  low: Int32Array;
}

const zonesCache = new WeakMap<Graph, { cliffs: Cliff[]; zones: CliffZones | null }>();

function inPolygon(poly: Pt[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The corners of the cells near (x, y). */
function cornersNear(g: Graph, x: number, y: number, r: number, fn: (v: number) => void) {
  cellsNear(g, x, y, r, (c) => {
    for (let i = g.cellEdgeStart[c]; i < g.cellEdgeStart[c + 1]; i++) {
      const e = g.cellEdges[i];
      fn(g.edges[e * 4]);
      fn(g.edges[e * 4 + 1]);
    }
  });
}

/** See CliffZones (null when there are no cliffs). */
export function cliffZones(g: Graph, cliffs: Cliff[] | undefined): CliffZones | null {
  if (!cliffs || !cliffs.length) return null;
  const hit = zonesCache.get(g);
  if (hit && hit.cliffs === cliffs) return hit.zones;
  const k = corners(g);
  const sp = g.spacing;
  const zone = new Int32Array(k.count).fill(-1);
  const dir = new Float32Array(k.count * 2);
  const low = new Int32Array(k.count).fill(-1);
  const onCliff = new Uint8Array(k.count);
  for (const c of cliffs) for (const v of c.vertices) if (v < k.count) onCliff[v] = 1;
  const B = sp * BEYOND_FOOT;
  cliffs.forEach((c, z) => {
    if (c.vertices.length < 2 || c.vertices.some((v) => v >= k.count)) return;
    const { pts, run, n, facing, H, face } = profileOf(g, c);
    const mark = (poly: Pt[], u: Pt) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of poly) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      cornersNear(g, (x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2 + sp, (v) => {
        if (onCliff[v] || zone[v] >= 0 || !inPolygon(poly, cx(g, v), cy(g, v))) return;
        zone[v] = z;
        dir[v * 2] = u[0];
        dir[v * 2 + 1] = u[1];
      });
    };
    // Behind the faces first (they win over the stretch past another face's foot): down the page.
    const feet: Pt[] = pts.map((p, i) => [p[0], p[1] + face[i]]);
    const front = (i: number) => face[i - 1] + face[i] > sp * 0.05;
    for (let i = 1; i < pts.length; i++) if (front(i)) mark([pts[i - 1], pts[i], feet[i], feet[i - 1]], [0, 1]);
    // Then past the foot (or the rim, where no face shows): the way the cliff faces.
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = front(i) ? [feet[i - 1], feet[i]] : [pts[i - 1], pts[i]];
      const na = facing[i - 1];
      const nb = facing[i];
      const ux = na[0] + nb[0];
      const uy = na[1] + nb[1];
      const len = Math.hypot(ux, uy) || 1;
      mark([a, b, [b[0] + nb[0] * B, b[1] + nb[1] * B], [a[0] + na[0] * B, a[1] + na[1] * B]], [ux / len, uy / len]);
    }
    // The low side nearby.
    const reach = H + B + sp;
    for (let i = 1; i < pts.length; i++)
      cornersNear(g, (pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2, run[i] - run[i - 1] + reach, (v) => {
        if (onCliff[v] || low[v] >= 0) return;
        const near = nearestOn(pts, run, n, cx(g, v), cy(g, v));
        if (near.v > 0 && near.d < reach) low[v] = z;
      });
  });
  const zones = { zone, dir, low };
  zonesCache.set(g, { cliffs, zones });
  return zones;
}

/** Where water goes next from a corner behind a cliff's face or past its foot (see CliffZones), or -1. */
export function cliffNext(g: Graph, k: Corners, Z: CliffZones, v: number, usable: (n: number) => boolean) {
  if (Z.zone[v] < 0) return -1;
  const ux = Z.dir[v * 2];
  const uy = Z.dir[v * 2 + 1];
  let best = -1;
  let bs = 0.3;
  for (let i = k.start[v]; i < k.start[v + 1]; i++) {
    const n = k.next[i];
    if (!usable(n)) continue;
    const dx = cx(g, n) - cx(g, v);
    const dy = cy(g, n) - cy(g, v);
    const s = (dx * ux + dy * uy) / (Math.hypot(dx, dy) || 1);
    if (s > bs) {
      bs = s;
      best = n;
    }
  }
  return best;
}

/** Cells under the cliffs' faces and along their rims: a biome's plants are not drawn there. */
export function underCliffs(g: Graph, cliffs: Cliff[]): Uint8Array {
  const out = new Uint8Array(g.cellCount);
  const k = corners(g);
  const sp = g.spacing;
  for (const c of cliffs) {
    if (c.vertices.length < 2 || c.vertices.some((v) => v >= k.count)) continue;
    const { pts, face } = profileOf(g, c);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const hang = Math.max(face[i - 1], face[i]);
      const quad: Pt[] = [a, b, [b[0], b[1] + face[i]], [a[0], a[1] + face[i - 1]]];
      cellsNear(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + hang / 2, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + hang + sp * 0.4, (cell) => {
        const x = g.centers[cell * 2];
        const y = g.centers[cell * 2 + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
        if (Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) < sp * 0.4 || (hang > 0 && inPolygon(quad, x, y))) out[cell] = 1;
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ drawing

/** A cliff as drawn, made once per cliff: paths in map units. */
export interface CliffDrawing {
  id: string;
  /** The rock face (where the drop faces the viewer), and its upper part (shaded on the painterly map). */
  face: Path2D;
  faceTop: Path2D;
  /** Hatching down the face, in tiers (the later ones left out when zoomed out) and line widths. */
  hatch: { path: Path2D; width: number; tier: number }[];
  /** The rim and the cracks, by line width. */
  lines: { path: Path2D; width: number }[];
  /** Loose rock at the foot of the face. */
  rocks: Path2D;
  rockLine: number;
  /** Waterfalls down the face where rivers go over it: the falling water, its lines, and the spray and ripples where it lands. */
  water: Path2D;
  waterLines: { path: Path2D; width: number }[];
  spray: Path2D;
  /** The space between hatching lines, in map units (how dense the face is). */
  gap: number;
  /** Its box, for leaving out cliffs off the screen; and its middle's height, to draw the ones further north first. */
  box: [number, number, number, number];
  y: number;
}

/** Hatch tiers: when zoomed out, only some of the hatching is drawn, so the face does not fill in black. */
export const HATCH_TIERS = 4;

function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A width bucket's path (a few line widths per cliff, so it draws quickly). */
function bucket<T extends { path: Path2D; width: number }>(list: T[], width: number, make: (w: number) => T) {
  const w = Math.round(width * 1000) / 1000;
  let b = list.find((q) => Math.abs(q.width - w) < w * 0.12);
  if (!b) list.push((b = make(w)));
  return b;
}

/**
 * A cliff as drawn: its rim along the wiggly borders, how far along each point is, the way it
 * faces there, and the depth of its face below each point (uneven, dying away at its ends, and
 * shown only as far as the cliff faces the viewer). The waterfalls use the same depths.
 */
function faceAlong(c: Cliff, g: Graph, noisy: NoisyEdges) {
  const sp = g.spacing;
  const r = seededRandom(hashId(c.id));
  const ring = isRing(c);
  const { pts } = borderLine(g, noisy, c.vertices);
  const run = runOf(pts);
  const L = run[run.length - 1] || 1;
  const ends = endsOf(L, ring, sp);
  const facing = smoothNormals(pts, run, sp * 0.6, ring);
  const H = faceHeight(c.meters, sp);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const heightAt = (s: number) => H * ends(s) * (0.86 + 0.09 * Math.sin((s / sp) * 2.1 + p1) + 0.05 * Math.sin((s / sp) * 5.3 + p2));
  const hs = run.map((s, i) => heightAt(s) * shows(facing[i]));
  return { ring, pts, run, L, facing, H, hs };
}

/** Draws the cliffs (made into paths once each; see CliffDrawing), with the waterfalls down their faces (`falls`, see cliffWaterfalls). */
export function cliffDrawings(cliffs: Cliff[], g: Graph, noisy: NoisyEdges, falls: AutoWaterfall[] = []): CliffDrawing[] {
  const k = corners(g);
  const sp = g.spacing;
  const U = MOUNTAIN_SPACINGS * sp;
  const out: CliffDrawing[] = [];
  for (const c of cliffs) {
    if (c.vertices.length < 2 || c.vertices.some((v) => v >= k.count)) continue;
    const r = seededRandom(hashId(c.id) ^ 0x51ed27);
    const { ring, pts, run, L, facing, H, hs } = faceAlong(c, g, noisy);
    const face = new Path2D();
    const faceTop = new Path2D();
    const hatch: CliffDrawing['hatch'] = [];
    const lines: CliffDrawing['lines'] = [];
    const rocks = new Path2D();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (x: number, y: number) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    const stroke = (a: Pt, b: Pt, width: number, tier = -1) => {
      let into: { path: Path2D };
      if (tier < 0) into = bucket(lines, width, (w) => ({ path: new Path2D(), width: w }));
      else {
        const w = Math.round(width * 1000) / 1000;
        let q = hatch.find((h) => h.tier === tier && Math.abs(h.width - w) < w * 0.12);
        if (!q) hatch.push((q = { path: new Path2D(), width: w, tier }));
        into = q;
      }
      into.path.moveTo(a[0], a[1]);
      into.path.lineTo(b[0], b[1]);
    };
    // A stroke that thins out toward its end: three pieces, each thinner.
    const tapered = (a: Pt, b: Pt, width: number, tier: number) => {
      const at = (t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      stroke(a, at(0.45), width, tier);
      stroke(at(0.45), at(0.75), width * 0.7, tier);
      stroke(at(0.75), b, width * 0.4, tier);
    };
    for (const p of pts) grow(p[0], p[1]);
    // The face: hanging straight down the page from the rim, one shape for each stretch that shows (so no seams).
    const showing = (i: number) => hs[i - 1] + hs[i] >= sp * 0.02;
    for (let i = 1; i < pts.length; ) {
      if (!showing(i)) {
        i++;
        continue;
      }
      let e = i;
      while (e + 1 < pts.length && showing(e + 1)) e++;
      for (const [path, depth] of [[face, 1], [faceTop, 0.4]] as const) {
        path.moveTo(pts[i - 1][0], pts[i - 1][1]);
        for (let j = i; j <= e; j++) path.lineTo(pts[j][0], pts[j][1]);
        for (let j = e; j >= i - 1; j--) path.lineTo(pts[j][0], pts[j][1] + hs[j] * depth);
        path.closePath();
      }
      i = e + 1;
    }
    // Waterfalls down the face: the stretch of rim each falls from (no rim line drawn there, so the river runs into it).
    const water = new Path2D();
    const waterLines: CliffDrawing['waterLines'] = [];
    const spray = new Path2D();
    const lip = new Uint8Array(pts.length);
    for (const f of falls) {
      if (f.cliff !== c.id || !f.sheet) continue;
      let i0 = 0;
      for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - f.x, pts[i][1] - f.y) < Math.hypot(pts[i0][0] - f.x, pts[i0][1] - f.y)) i0 = i;
      const near = (i: number) => Math.abs(i - i0) <= 14;
      // The rim's height and the face's depth at x, near the fall.
      const rimAt = (x: number) => {
        let best: { y: number; h: number } | null = null;
        for (let i = Math.max(1, i0 - 14); i <= Math.min(pts.length - 1, i0 + 14); i++) {
          const [ax, ay] = pts[i - 1];
          const [bx, by] = pts[i];
          if ((x - ax) * (x - bx) > 0 || ax === bx) continue;
          const t = (x - ax) / (bx - ax);
          const y = ay + (by - ay) * t;
          if (!best || Math.abs(y - f.y) < Math.abs(best.y - f.y)) best = { y, h: hs[i - 1] + (hs[i] - hs[i - 1]) * t };
        }
        return best ?? { y: f.y, h: hs[i0] };
      };
      const xs = Array.from({ length: 7 }, (_, j) => f.x - f.half + (j / 6) * f.half * 2);
      const tops = xs.map(rimAt);
      const top: Pt[] = xs.map((x, j) => [x, tops[j].y]);
      const bottom: Pt[] = xs.map((x, j) => [x, tops[j].y + tops[j].h]);
      water.moveTo(top[0][0], top[0][1]);
      for (const p of [...top.slice(1), ...[...bottom].reverse()]) water.lineTo(p[0], p[1]);
      water.closePath();
      // No rim line where the river runs along the rim to the fall, or where it goes over.
      let i1 = i0;
      for (let i = 0; i < pts.length; i++) if (near(i) && Math.hypot(pts[i][0] - f.from[0], pts[i][1] - f.from[1]) < Math.hypot(pts[i1][0] - f.from[0], pts[i1][1] - f.from[1])) i1 = i;
      for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) lip[i] = 1;
      for (let i = 0; i < pts.length; i++) if (near(i) && Math.abs(pts[i][0] - f.x) < f.half * 0.85) lip[i] = 1;
      const line = (a: Pt, b: Pt, width: number) => {
        const into = bucket(waterLines, width, (w) => ({ path: new Path2D(), width: w }));
        into.path.moveTo(a[0], a[1]);
        into.path.lineTo(b[0], b[1]);
      };
      // Its sides, and streaks down the falling water.
      const n = xs.length - 1;
      line(top[0], [bottom[0][0], top[0][1] + (bottom[0][1] - top[0][1]) * 0.92], U * LINE.lit * 1.2);
      line(top[n], [bottom[n][0], top[n][1] + (bottom[n][1] - top[n][1]) * 0.92], U * LINE.lit * 1.2);
      for (let j = 1; j < n; j++) if (r() < 0.55) line([xs[j], top[j][1] + (bottom[j][1] - top[j][1]) * (0.05 + r() * 0.2)], [xs[j], top[j][1] + (bottom[j][1] - top[j][1]) * (0.6 + r() * 0.3)], U * LINE.lit * 0.9);
      // Spray where it lands, and ripples spreading out below.
      const footY = Math.max(...bottom.map((p) => p[1]));
      const w = f.half * 2;
      const puffs = Math.max(2, Math.min(5, Math.round(w / (sp * 0.12))));
      for (let j = 0; j < puffs; j++) {
        const x = f.x - f.half + ((j + 0.5) / puffs) * w;
        const rad = (w / puffs) * (0.6 + r() * 0.15);
        spray.moveTo(x - rad, footY);
        spray.arc(x, footY, rad, Math.PI, 0);
        spray.closePath();
      }
      for (let j = 1; j <= 2; j++) {
        const rw = w * (1 + j * 0.5);
        line([f.x - rw / 2, footY + j * sp * 0.09], [f.x + rw / 2, footY + j * sp * 0.09], U * LINE.lit * (1.1 - j * 0.3));
      }
      grow(f.x - w, footY + sp * 0.3);
      grow(f.x + w, footY + sp * 0.3);
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!showing(i)) continue;
      const nn: Pt = [(facing[i - 1][0] + facing[i][0]) / 2, (facing[i - 1][1] + facing[i][1]) / 2];
      const fa: Pt = [a[0], a[1] + hs[i - 1]];
      const fb: Pt = [b[0], b[1] + hs[i]];
      grow(fa[0], fa[1]);
      grow(fb[0], fb[1]);
      // Hatching: strokes from the rim down, closer together where the face turns away from the light (from the upper left).
      const shade = 0.5 + 0.5 * nn[0];
      const span = Math.abs(b[0] - a[0]);
      const gap = U * LINE.hatchGap * (1.45 - 0.75 * shade);
      for (let t = r() * gap; t < span; t += gap * (0.8 + r() * 0.4)) {
        const f = span ? t / span : 0;
        const top: Pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        const hh = hs[i - 1] + (hs[i] - hs[i - 1]) * f;
        if (hh < sp * 0.05) continue;
        const len = hh * (0.55 + r() * 0.5);
        if (len < sp * 0.04) continue;
        tapered([top[0], top[1] - U * 0.002], [top[0] + (r() - 0.5) * U * 0.004, top[1] + len], U * LINE.hatch, Math.floor(r() * HATCH_TIERS));
      }
      // Now and then a crack, darker and jagged, a long way down.
      if (r() < 0.12 * (run[i] - run[i - 1]) / (sp * 0.15)) {
        const f = r();
        const top: Pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        const hh = hs[i - 1] + (hs[i] - hs[i - 1]) * f;
        const jag: Pt[] = [top];
        displace(r, top, [top[0] + (r() - 0.5) * U * 0.02, top[1] + hh * (0.5 + r() * 0.4)], 0.25, 3, jag);
        for (let j = 1; j < jag.length; j++) stroke(jag[j - 1], jag[j], U * LINE.ridge * 0.8 * (1 - (0.6 * j) / jag.length));
      }
      // Loose rock at the foot, under the taller parts.
      if (hs[i] > H * 0.4 && r() < 0.35) {
        const f = r();
        const x = a[0] + (b[0] - a[0]) * f;
        const y = a[1] + (b[1] - a[1]) * f + (hs[i - 1] + (hs[i] - hs[i - 1]) * f) * (0.95 + r() * 0.12);
        const size = U * (r() < 0.15 ? 0.016 + r() * 0.008 : 0.005 + r() * 0.008);
        const m = 5 + Math.floor(r() * 3);
        const spin = r() * Math.PI;
        for (let j = 0; j <= m; j++) {
          const ang = spin + ((j % m) / m) * Math.PI * 2;
          const rr = size * (0.7 + ((j * 7919) % 5) * 0.1);
          if (j === 0) rocks.moveTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.72);
          else rocks.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.72);
        }
        rocks.closePath();
        grow(x, y + size);
      }
    }
    // The rim, along the whole cliff (but where a waterfall goes over), thinning out at its ends.
    for (let i = 1; i < pts.length; i++) {
      if (lip[i - 1] && lip[i]) continue;
      const s = (run[i - 1] + run[i]) / 2;
      const f = ring ? 1 : Math.min(1, s / (sp * 0.8), (L - s) / (sp * 0.8));
      stroke(pts[i - 1], pts[i], U * LINE.outline * (0.35 + 0.65 * Math.max(0, f)));
    }
    out.push({ id: c.id, face, faceTop, hatch, lines, rocks, rockLine: U * LINE.lit * 1.2, water, waterLines, spray, gap: U * LINE.hatchGap, box: [x0, y0, x1, y1], y: (y0 + y1) / 2 });
  }
  return out.sort((a, b) => a.y - b.y);
}

// ------------------------------------------------------------------ waterfalls

/** A waterfall the app draws where a river goes over a cliff. */
export interface AutoWaterfall {
  /** Its lip: where the river goes over (from `from`, where the river reached the cliff, it runs along the rim). */
  x: number;
  y: number;
  from: Pt;
  size: number;
  /** The way it falls: the compass direction the cliff's drop faces there, in degrees (the nearest of 8 is drawn). */
  angle: number;
  key: string;
  /** The cliff it falls down. Where its face shows, the water is drawn with the cliff (`sheet`), down the face from the rim, about `half` either side of x; elsewhere as a waterfall icon. */
  cliff: string;
  sheet: boolean;
  half: number;
  /** The river it is on, how far along the river's line the lip is, and how far the water falls (the face's depth there; 0 at the water's edge or out of sight). */
  river: string;
  along: number;
  drop: number;
  /** Whether the river ends there (at the water's edge). */
  end: boolean;
}

/** How much wider than itself a river is where it goes over a waterfall (Caleb: it widens up to the fall and narrows again after). */
export const FALL_WIDEN = 1.8;

/** The key that names the waterfall where a river goes over a cliff (see MapInfo.hiddenAuto); a second place the same river goes over the same cliff gets a number. */
export const waterfallKey = (river: string, cliff: string, nth = 0) => `w${river}:${cliff}${nth ? `:${nth + 1}` : ''}`;


/** A river as drawn, as waterfallsOn needs it: its corners, where each falls along its line, the line and its widths. */
export interface RiverRun {
  id: string;
  vertices: number[];
  at: number[];
  pts: Pt[];
  widths: number[];
}

/**
 * The waterfalls where rivers go over cliffs: where a river runs along a cliff (every corner
 * has three borders, so a river going over one runs along it for at least one border) and
 * leaves it on the other side from where it came; or ends on a cliff at the water's edge,
 * coming from the high side (it falls into the sea or a lake). The waterfall is on the last
 * border it shares with the cliff, falling the way the drop faces there, as far as the face
 * reaches, and wider than the river. Ones Caleb took over are left out.
 */
export function cliffWaterfalls(g: Graph, noisy: NoisyEdges, land: Uint8Array, rivers: RiverRun[], cliffs: Cliff[], hidden: ReadonlySet<string>): AutoWaterfall[] {
  const k = corners(g);
  const out: AutoWaterfall[] = [];
  for (const c of cliffs) {
    if (c.vertices.length < 2 || c.vertices.some((v) => v >= k.count)) continue;
    const { pts, ring, n, facing, H } = profileOf(g, c);
    let drawn: ReturnType<typeof faceAlong> | null = null;
    // The face's depth where it is drawn, nearest point p.
    const depthAt = (p: Pt) => {
      drawn ??= faceAlong(c, g, noisy);
      let best = 0;
      for (let i = 1; i < drawn.pts.length; i++) if (Math.hypot(drawn.pts[i][0] - p[0], drawn.pts[i][1] - p[1]) < Math.hypot(drawn.pts[best][0] - p[0], drawn.pts[best][1] - p[1])) best = i;
      return drawn.hs[best];
    };
    const where = new Map<number, number>();
    c.vertices.forEach((v, i) => !where.has(v) && where.set(v, i));
    const last = c.vertices.length - 1;
    // Whether corners a and b are next to each other along the cliff.
    const along = (a: number, b: number) => {
      const i = where.get(a);
      const j = where.get(b);
      if (i === undefined || j === undefined) return false;
      return Math.abs(i - j) === 1 || (ring && ((i === 0 && j === last - 1) || (j === 0 && i === last - 1)));
    };
    // Which side of the cliff a corner off it is on, seen from cliff corner c0: + the drop side.
    const sideOf = (c0: number, v: number) => {
      const i = where.get(c0)!;
      return (cx(g, v) - pts[i][0]) * n.at[i][0] + (cy(g, v) - pts[i][1]) * n.at[i][1];
    };
    for (const r of rivers) {
      let nth = 0;
      const V = r.vertices;
      const riverRun = runOf(r.pts);
      for (let p = 0; p < V.length; p++) {
        if (!where.has(V[p])) continue;
        let q = p;
        while (q + 1 < V.length && along(V[q], V[q + 1])) q++;
        const before = p > 0 ? V[p - 1] : -1;
        const after = q + 1 < V.length ? V[q + 1] : -1;
        // Ending on the cliff at the water's edge.
        const into = after < 0 && q === V.length - 1 && cornerKind(k, land, V[q]) !== 1;
        // Coming from one side and leaving on the other; or starting on the rim and leaving on the low side; or ending at the water coming from the high side.
        const goes =
          (before >= 0 && after >= 0 && q > p && Math.sign(sideOf(V[p], before)) !== Math.sign(sideOf(V[q], after))) ||
          (before < 0 && after >= 0 && q > p && sideOf(V[q], after) > 0) ||
          (before >= 0 && into && sideOf(V[p], before) < 0);
        if (goes) {
          // At the corner where it goes over (or, ending on the cliff, where it ends); it runs
          // along the rim from where it reached the cliff.
          const b = r.at[q];
          const at: Pt = r.pts[b];
          const from: Pt = r.pts[r.at[p]];
          const width = r.widths[b];
          const along = riverRun[b];
          const i0 = where.get(V[q > p ? q - 1 : q])!;
          const i1 = where.get(V[q])!;
          const nx = facing[i0][0] + facing[i1][0];
          const ny = facing[i0][1] + facing[i1][1];
          const angle = ((Math.atan2(nx, -ny) * 180) / Math.PI + 360) % 360;
          // The water falls as far as the face reaches below (where the face is out of sight, a
          // waterfall drawing just wider than the river, as it widens there).
          const drop = depthAt(at);
          const wide = width * FALL_WIDEN;
          const sheet = drop > H * 0.35;
          const half = Math.max(wide * 0.55, g.spacing * 0.05);
          const size = sheet ? Math.max(drop / FALL, wide * 2.4) : wide * 2.4;
          const key = waterfallKey(r.id, c.id, nth++);
          if (sheet || !hidden.has(key)) out.push({ x: at[0], y: at[1], from, size, angle, key, cliff: c.id, sheet, half, river: r.id, along, drop: sheet ? drop : 0, end: after < 0 });
        }
        p = q;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ making cliffs

/** The cliff under map point (x, y): within `tolerance` of its rim, or on its face. */
export function cliffAt(g: Graph, cliffs: Cliff[], x: number, y: number, tolerance: number): string | null {
  const sp = g.spacing;
  let best: { id: string; d: number } | null = null;
  for (const c of cliffs) {
    if (c.vertices.length < 2) continue;
    const { pts, run, n, face } = profileOf(g, c);
    const near = nearestOn(pts, run, n, x, y);
    let d = near.d;
    for (let i = 1; i < pts.length; i++) {
      if (face[i - 1] + face[i] <= 0) continue;
      const quad: Pt[] = [pts[i - 1], pts[i], [pts[i][0], pts[i][1] + face[i]], [pts[i - 1][0], pts[i - 1][1] + face[i - 1]]];
      if (inPolygon(quad, x, y)) d = 0;
    }
    if (d < tolerance + sp * 0.2 && (!best || d < best.d)) best = { id: c.id, d };
  }
  return best?.id ?? null;
}

/** A cliff's length along its borders (straight from corner to corner), in map units. */
export function cliffLength(g: Graph, c: Cliff) {
  const run = runOf(cornerPts(g, c));
  return run[run.length - 1];
}

/**
 * A line drawn by hand moved onto the borders nearest it, as a cliff: the corners it passes,
 * joined along borders where it skips one, without loops, over land and the coast only. A
 * line that ends where it began closes into a ring. Null if too little is left.
 */
export function snapCliff(g: Graph, land: Uint8Array, pts: Pt[]): number[] | null {
  const k = corners(g);
  const ok = (v: number) => cornerKind(k, land, v) !== 0;
  // Ending where it began: a ring. It is snapped as a line up to where it comes back, then closed.
  let length = 0;
  let cut = pts.length;
  for (let i = 1; i < pts.length; i++) {
    length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (length > g.spacing * 6 && Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) < g.spacing * 1.2) {
      cut = i;
      break;
    }
  }
  const ring = cut < pts.length || (length > g.spacing * 6 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < g.spacing * 1.2);
  const line = ring ? pts.slice(0, Math.max(2, cut)) : pts;
  const step = g.spacing * 0.3;
  const seq: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[Math.min(line.length - 1, i + 1)];
    const m = i === line.length - 1 ? 1 : Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < m; j++) {
      const v = nearestCorner(g, ax + ((bx - ax) * j) / m, ay + ((by - ay) * j) / m, ok);
      if (v >= 0 && v !== seq[seq.length - 1]) seq.push(v);
    }
  }
  if (seq.length < 2) return null;
  let path: number[] = [seq[0]];
  for (let i = 1; i < seq.length; i++) {
    const last = path[path.length - 1];
    if (seq[i] === last) continue;
    if (edgeBetween(k, last, seq[i]) >= 0) path.push(seq[i]);
    else {
      const way = pathBetween(g, k, last, seq[i], ok, g.spacing * 4);
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
  if (ring && path.length > 3) {
    const inner = new Set(path.slice(1, -1));
    const back = pathBetween(g, k, path[path.length - 1], path[0], (v) => ok(v) && !inner.has(v), g.spacing * 4);
    if (back) path = [...path, ...back.slice(1)];
  }
  return path.length >= 2 ? path : null;
}

/**
 * Cliffs as they should be on this map: each a chain of neighboring corners on it (a gap is
 * joined up along borders); cliffs that cannot be fitted are left out. `changed` says
 * whether anything was done.
 */
export function fitCliffs(g: Graph, cliffs: Cliff[]): { cliffs: Cliff[]; changed: boolean } {
  const k = corners(g);
  const out: Cliff[] = [];
  let changed = false;
  for (const c of cliffs) {
    if (c.vertices.length < 2 || !c.vertices.every((v) => Number.isInteger(v) && v >= 0 && v < k.count)) {
      changed = true;
      continue;
    }
    const path: number[] = [c.vertices[0]];
    let ok = true;
    for (let i = 1; i < c.vertices.length; i++) {
      const a = path[path.length - 1];
      const b = c.vertices[i];
      if (a === b) continue;
      if (edgeBetween(k, a, b) >= 0) path.push(b);
      else {
        const way = pathBetween(g, k, a, b, () => true, g.spacing * 6);
        if (!way) {
          ok = false;
          break;
        }
        path.push(...way.slice(1));
      }
    }
    if (!ok || path.length < 2) {
      changed = true;
      continue;
    }
    if (path.length !== c.vertices.length) changed = true;
    out.push(path.length === c.vertices.length ? c : { ...c, vertices: path });
  }
  return { cliffs: out, changed };
}

/**
 * The rivers as drawn at the waterfalls on them (Caleb). Over about a polygon before a fall each
 * widens to FALL_WIDEN times its width, and narrows back over about a polygon below it. Below a
 * fall down a cliff's face, the river is drawn straight down from the lip to the pool at the
 * foot (behind the falling water), then on to where its borders come out from under the face,
 * so it leaves the pool where the water lands. Only the drawing changes, never the river.
 */
export function riversAtFalls<T extends RiverRun>(rivers: T[], falls: AutoWaterfall[], spacing: number): T[] {
  if (!falls.length) return rivers;
  const before = spacing * 1.1;
  const after = spacing * 1.2;
  const nearest = (pts: Pt[], x: number, y: number) => {
    let best = 0;
    for (let k = 1; k < pts.length; k++) if (Math.hypot(pts[k][0] - x, pts[k][1] - y) < Math.hypot(pts[best][0] - x, pts[best][1] - y)) best = k;
    return best;
  };
  return rivers.map((r) => {
    const mine = falls.filter((f) => f.river === r.id).sort((a, b) => b.along - a.along);
    if (!mine.length) return r;
    let pts = r.pts;
    let widths = r.widths;
    // Last fall first, so the earlier ones' places along the line stay put.
    for (const f of mine) {
      if (!f.sheet || f.end || f.drop <= 0) continue;
      const run = runOf(pts);
      const L = nearest(pts, f.x, f.y);
      const foot: Pt = [f.x, f.y + f.drop];
      let E = L + 1;
      while (E < pts.length && pts[E][1] < foot[1] && run[E] - run[L] < f.drop * 2.5) E++;
      if (E >= pts.length) continue;
      pts = [...pts.slice(0, L + 1), foot, ...pts.slice(E)];
      widths = [...widths.slice(0, L + 1), widths[L], ...widths.slice(E)];
    }
    const run = runOf(pts);
    const spans = mine.map((f) => {
      const L = nearest(pts, f.x, f.y);
      const down = f.sheet && !f.end && f.drop > 0 && L + 1 < pts.length ? run[L + 1] : run[L];
      return { lip: run[L], foot: down, end: f.end };
    });
    widths = widths.map((w, k) => {
      const s = run[k];
      let m = 1;
      for (const { lip, foot, end } of spans) {
        if (s >= lip - before && s <= lip) m = Math.max(m, 1 + (FALL_WIDEN - 1) * smooth((s - (lip - before)) / before));
        else if (s > lip && s <= foot) m = Math.max(m, FALL_WIDEN);
        else if (!end && s > foot && s <= foot + after) m = Math.max(m, FALL_WIDEN - (FALL_WIDEN - 1) * smooth((s - foot) / after));
      }
      return w * m;
    });
    return { ...r, pts, widths };
  });
}
