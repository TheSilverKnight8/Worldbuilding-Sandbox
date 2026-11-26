import { Delaunay } from 'd3-delaunay';
import { seededRandom } from '../rng';

// The map is a graph of irregular polygons (cells), like Nortantis: random points, their
// Voronoi cells, evened out with Lloyd relaxation. The graph is made once, when the map
// is set up, and stored with the world, so later changes to this code never move the
// polygons of an existing map.

/** The map's long side in map units. Everything is drawn in map units; kilometers come from the map's size in km. */
export const MAP_LONG_SIDE = 1000;
/** Cells in a new map (Nortantis allows 2,000 to 32,000). */
export const DEFAULT_CELLS = 16000;
const LLOYD_ITERATIONS = 2;

export interface Graph {
  /** Map size in map units. */
  width: number;
  height: number;
  cellCount: number;
  /** Cell centers, x and y per cell. */
  centers: Float32Array;
  /** Polygon corners, x and y per vertex. */
  vertices: Float32Array;
  /** Four numbers per edge: vertex 0, vertex 1, the cell on one side, the cell on the other (-1 at the map's edge). */
  edges: Int32Array;
  edgeCount: number;
  /** The edges around each cell: cellEdges[cellEdgeStart[c] .. cellEdgeStart[c + 1]). */
  cellEdgeStart: Int32Array;
  cellEdges: Int32Array;
  /** Average distance between neighboring cell centers, in map units. */
  spacing: number;
  /** Buckets of cells by position, for finding the cell at a point quickly. */
  bucketSize: number;
  bucketCols: number;
  bucketRows: number;
  bucketStart: Int32Array;
  bucketCells: Int32Array;
}

export function mapUnitsFor(widthKm: number, heightKm: number) {
  if (widthKm >= heightKm) return { width: MAP_LONG_SIDE, height: (MAP_LONG_SIDE * heightKm) / widthKm };
  return { width: (MAP_LONG_SIDE * widthKm) / heightKm, height: MAP_LONG_SIDE };
}

function centroid(poly: ArrayLike<[number, number]> & { length: number }) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) return null;
  return [cx / (3 * a), cy / (3 * a)] as const;
}

/** Makes a new polygon graph of the given size in map units. */
export function generateGraph(width: number, height: number, cellCount: number, seed: number): Graph {
  const rand = seededRandom(seed);
  const pts = new Float64Array(cellCount * 2);
  for (let i = 0; i < cellCount; i++) {
    pts[i * 2] = rand() * width;
    pts[i * 2 + 1] = rand() * height;
  }
  const delaunay = new Delaunay(pts);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  // Lloyd relaxation: move each point to the middle of its cell, so cells come out more even.
  for (let it = 0; it < LLOYD_ITERATIONS; it++) {
    for (let i = 0; i < cellCount; i++) {
      const poly = voronoi.cellPolygon(i);
      const c = poly && centroid(poly);
      if (c) {
        pts[i * 2] = c[0];
        pts[i * 2 + 1] = c[1];
      }
    }
    delaunay.update();
    voronoi.update();
  }

  // Corners shared by neighboring cells become one vertex.
  const vertexIndex = new Map<string, number>();
  const verts: number[] = [];
  const vid = (x: number, y: number) => {
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
    let v = vertexIndex.get(key);
    if (v === undefined) {
      v = verts.length / 2;
      verts.push(x, y);
      vertexIndex.set(key, v);
    }
    return v;
  };
  const edgeIndex = new Map<number, number>();
  const edges: number[] = [];
  const STRIDE = 2 ** 21;
  for (let i = 0; i < cellCount; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly) continue;
    for (let k = 0; k < poly.length - 1; k++) {
      const a = vid(poly[k][0], poly[k][1]);
      const b = vid(poly[k + 1][0], poly[k + 1][1]);
      if (a === b) continue;
      const key = Math.min(a, b) * STRIDE + Math.max(a, b);
      const e = edgeIndex.get(key);
      if (e === undefined) {
        edgeIndex.set(key, edges.length / 4);
        edges.push(a, b, i, -1);
      } else if (edges[e * 4 + 3] === -1 && edges[e * 4 + 2] !== i) edges[e * 4 + 3] = i;
    }
  }
  const centers = new Float32Array(cellCount * 2);
  for (let i = 0; i < cellCount * 2; i++) centers[i] = pts[i];
  return derive(width, height, cellCount, centers, new Float32Array(verts), new Int32Array(edges));
}

/** Works out the lookup tables that are not stored (cell edges, buckets). */
function derive(width: number, height: number, cellCount: number, centers: Float32Array, vertices: Float32Array, edges: Int32Array): Graph {
  const edgeCount = edges.length / 4;
  const counts = new Int32Array(cellCount + 1);
  for (let e = 0; e < edgeCount; e++) {
    counts[edges[e * 4 + 2]]++;
    if (edges[e * 4 + 3] >= 0) counts[edges[e * 4 + 3]]++;
  }
  const cellEdgeStart = new Int32Array(cellCount + 1);
  for (let c = 0; c < cellCount; c++) cellEdgeStart[c + 1] = cellEdgeStart[c] + counts[c];
  const fillAt = cellEdgeStart.slice(0, cellCount);
  const cellEdges = new Int32Array(cellEdgeStart[cellCount]);
  for (let e = 0; e < edgeCount; e++) {
    cellEdges[fillAt[edges[e * 4 + 2]]++] = e;
    const b = edges[e * 4 + 3];
    if (b >= 0) cellEdges[fillAt[b]++] = e;
  }
  const spacing = Math.sqrt((width * height) / cellCount);
  const bucketSize = spacing * 2;
  const bucketCols = Math.max(1, Math.ceil(width / bucketSize));
  const bucketRows = Math.max(1, Math.ceil(height / bucketSize));
  const bucketOf = (c: number) => {
    const bx = Math.min(bucketCols - 1, Math.max(0, Math.floor(centers[c * 2] / bucketSize)));
    const by = Math.min(bucketRows - 1, Math.max(0, Math.floor(centers[c * 2 + 1] / bucketSize)));
    return by * bucketCols + bx;
  };
  const bcount = new Int32Array(bucketCols * bucketRows + 1);
  for (let c = 0; c < cellCount; c++) bcount[bucketOf(c)]++;
  const bucketStart = new Int32Array(bucketCols * bucketRows + 1);
  for (let b = 0; b < bucketCols * bucketRows; b++) bucketStart[b + 1] = bucketStart[b] + bcount[b];
  const bfill = bucketStart.slice(0, bucketCols * bucketRows);
  const bucketCells = new Int32Array(cellCount);
  for (let c = 0; c < cellCount; c++) bucketCells[bfill[bucketOf(c)]++] = c;
  return { width, height, cellCount, centers, vertices, edges, edgeCount, cellEdgeStart, cellEdges, spacing, bucketSize, bucketCols, bucketRows, bucketStart, bucketCells };
}

/** The other cell across an edge from `cell`, or -1. */
export function across(g: Graph, e: number, cell: number) {
  const a = g.edges[e * 4 + 2];
  return a === cell ? g.edges[e * 4 + 3] : a;
}

/** Calls fn for every cell whose center is within `radius` of (x, y). */
export function cellsNear(g: Graph, x: number, y: number, radius: number, fn: (cell: number) => void) {
  const r2 = radius * radius;
  const bx0 = Math.max(0, Math.floor((x - radius) / g.bucketSize));
  const bx1 = Math.min(g.bucketCols - 1, Math.floor((x + radius) / g.bucketSize));
  const by0 = Math.max(0, Math.floor((y - radius) / g.bucketSize));
  const by1 = Math.min(g.bucketRows - 1, Math.floor((y + radius) / g.bucketSize));
  for (let by = by0; by <= by1; by++)
    for (let bx = bx0; bx <= bx1; bx++) {
      const b = by * g.bucketCols + bx;
      for (let k = g.bucketStart[b]; k < g.bucketStart[b + 1]; k++) {
        const c = g.bucketCells[k];
        const dx = g.centers[c * 2] - x;
        const dy = g.centers[c * 2 + 1] - y;
        if (dx * dx + dy * dy <= r2) fn(c);
      }
    }
}

/** The cell under a point (the one whose center is nearest), or -1 outside the map. */
export function cellAt(g: Graph, x: number, y: number) {
  if (x < 0 || y < 0 || x > g.width || y > g.height) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let r = g.bucketSize; best < 0 || r < g.bucketSize * 4; r += g.bucketSize) {
    cellsNear(g, x, y, r, (c) => {
      const dx = g.centers[c * 2] - x;
      const dy = g.centers[c * 2 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    if (best >= 0) break;
  }
  return best;
}

// ---------------------------------------------------------------- storage

const GRAPH_FORMAT = 1;
const HEADER = 6 * 4;

/** The graph as bytes for storage: a small header, then centers, vertices and edges. */
export function graphToBlob(g: Graph) {
  const vertexCount = g.vertices.length / 2;
  const buf = new ArrayBuffer(HEADER + g.centers.byteLength + g.vertices.byteLength + g.edges.byteLength);
  const dv = new DataView(buf);
  dv.setUint32(0, GRAPH_FORMAT, true);
  dv.setFloat32(4, g.width, true);
  dv.setFloat32(8, g.height, true);
  dv.setUint32(12, g.cellCount, true);
  dv.setUint32(16, vertexCount, true);
  dv.setUint32(20, g.edgeCount, true);
  let at = HEADER;
  new Float32Array(buf, at, g.centers.length).set(g.centers);
  at += g.centers.byteLength;
  new Float32Array(buf, at, g.vertices.length).set(g.vertices);
  at += g.vertices.byteLength;
  new Int32Array(buf, at, g.edges.length).set(g.edges);
  return new Blob([buf], { type: 'application/octet-stream' });
}

/** Reads a stored graph back, or null if the bytes are damaged. */
export async function graphFromBlob(blob: Blob): Promise<Graph | null> {
  const buf = await blob.arrayBuffer();
  if (buf.byteLength < HEADER) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== GRAPH_FORMAT) return null;
  const width = dv.getFloat32(4, true);
  const height = dv.getFloat32(8, true);
  const cellCount = dv.getUint32(12, true);
  const vertexCount = dv.getUint32(16, true);
  const edgeCount = dv.getUint32(20, true);
  if (buf.byteLength !== HEADER + (cellCount * 2 + vertexCount * 2 + edgeCount * 4) * 4) return null;
  let at = HEADER;
  const centers = new Float32Array(buf.slice(at, at + cellCount * 8));
  at += cellCount * 8;
  const vertices = new Float32Array(buf.slice(at, at + vertexCount * 8));
  at += vertexCount * 8;
  const edges = new Int32Array(buf.slice(at, at + edgeCount * 16));
  for (let e = 0; e < edgeCount; e++) {
    const v0 = edges[e * 4];
    const v1 = edges[e * 4 + 1];
    const a = edges[e * 4 + 2];
    const b = edges[e * 4 + 3];
    if (v0 < 0 || v1 < 0 || v0 >= vertexCount || v1 >= vertexCount || a < 0 || a >= cellCount || b < -1 || b >= cellCount) return null;
  }
  return derive(width, height, cellCount, centers, vertices, edges);
}

export function landToBlob(land: Uint8Array) {
  return new Blob([land.slice().buffer], { type: 'application/octet-stream' });
}

export async function landFromBlob(blob: Blob | undefined, cellCount: number): Promise<Uint8Array | null> {
  if (!blob || blob.size !== cellCount) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
