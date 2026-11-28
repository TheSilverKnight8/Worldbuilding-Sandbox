import { newId } from '../ids';
import { mixSeed, seededRandom } from '../rng';
import type { Cliff, PlacedIcon, River, TerrainKind } from '../world/types';
import { across, cellAt, cellsNear, type Graph } from './graph';
import { corners, drainage } from './rivers';
import { KINDS, computeHeights, footOffset, polygonScale } from './terrain';

// Random generation (Stage 6): a whole map made once, at setup, then edited by hand. It is
// the app's own code, using general techniques (none of Nortantis's code):
//
// 1. Land: landmasses shaped by the setting (one continent, a few, or many islands), made
//    uneven with noise, plus plates grown from random cells: where two plates push together
//    the ground rises in a ridge, so mountains follow ridges. The sea level is set so the
//    amount of land asked for is above it. Specks of land and puddles are tidied away.
// 2. Elevation: low near the coast, rising inland, with the ridges as mountain ranges.
// 3. Lakes: a few hollows inland filled with water.
// 4. Terrain, stored like what is made by hand (Caleb): plateaus and cliffs first (cliffs
//    along polygon borders: escarpments inland, dropping to the lower side, and some along
//    the shores of the sea and lakes), then volcanoes, then mountains and hills along the high
//    ground, each sized by its polygon as Nortantis does and spaced across a range.
// 5. Rivers: rain gathers downhill (over the elevation the icons shape); where enough has
//    gathered it is a river. Each river runs from its source to the sea, or into a bigger
//    river; widths grow with the water they carry. Rivers pass through lakes (drawn on land only).
// 6. Biomes from temperature and moisture (a table after Whittaker's): temperature from the
//    climate setting, colder to the north and higher up; moisture from the sea, the rivers and
//    lakes, less behind mountains (winds from the west).

export type LandShape = 'continent' | 'continents' | 'islands';

export interface GenSettings {
  /** How much of the map is land, 0.1 to 0.7. */
  land: number;
  shape: LandShape;
  /** How mountainous, 0 (few, low ranges) to 1 (many, high ranges). */
  mountains: number;
  /** Climate, 0 (cold) to 1 (hot). */
  climate: number;
}

export const DEFAULT_GEN: GenSettings = { land: 0.35, shape: 'continents', mountains: 0.5, climate: 0.5 };

/** The starter biomes generation paints with, by name; a cell's biome value is the index here plus one. */
export const GEN_BIOMES = ['Forest', 'Pine forest', 'Jungle', 'Grassland', 'Desert', 'Swamp', 'Tundra', 'Ice'] as const;
type BiomeName = (typeof GEN_BIOMES)[number];
const BIOME = (name: BiomeName) => GEN_BIOMES.indexOf(name) + 1;

export interface GeneratedMap {
  land: Uint8Array;
  /** 0 for none (water), else an index into GEN_BIOMES plus one. */
  biome: Uint8Array;
  /** The painted elevation, in meters (the icons shape the rest). */
  elevation: Int16Array;
  icons: PlacedIcon[];
  rivers: River[];
  cliffs: Cliff[];
}

// ------------------------------------------------------------------ helpers

/** Gradient noise (Perlin's method), seeded; about -0.7 to 0.7. */
function gradientNoise(seed: number) {
  const r = seededRandom(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const h00 = perm[perm[X] + Y];
    const h10 = perm[perm[X + 1] + Y];
    const h01 = perm[perm[X] + Y + 1];
    const h11 = perm[perm[X + 1] + Y + 1];
    const d00 = gx[h00] * xf + gy[h00] * yf;
    const d10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const d01 = gx[h01] * xf + gy[h01] * (yf - 1);
    const d11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const a = d00 + u * (d10 - d00);
    const b = d01 + u * (d11 - d01);
    return a + v * (b - a);
  };
}

type Noise = ReturnType<typeof gradientNoise>;

/** Noise at several scales added together (larger features with smaller detail on them). */
function fbm(n: Noise, x: number, y: number, octaves: number) {
  let s = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * n(x * f + o * 17.3, y * f - o * 9.1);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Each cell's neighbors, as flat lists. */
function neighborsOf(g: Graph) {
  const start = new Int32Array(g.cellCount + 1);
  const list: number[] = [];
  for (let c = 0; c < g.cellCount; c++) {
    start[c] = list.length;
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
      const n = across(g, g.cellEdges[k], c);
      if (n >= 0) list.push(n);
    }
  }
  start[g.cellCount] = list.length;
  return { start, list: Int32Array.from(list) };
}
type Neighbors = ReturnType<typeof neighborsOf>;

/** A binary heap of (key, value) pairs, smallest key first. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, value: number) {
    const { k, v } = this;
    k.push(key);
    v.push(value);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Steps (cell to neighboring cell) from the nearest cell where `from` is true; -1 where none can be reached. */
function stepsFrom(g: Graph, nb: Neighbors, from: (c: number) => boolean) {
  const d = new Int32Array(g.cellCount).fill(-1);
  const queue: number[] = [];
  for (let c = 0; c < g.cellCount; c++)
    if (from(c)) {
      d[c] = 0;
      queue.push(c);
    }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    for (let k = nb.start[c]; k < nb.start[c + 1]; k++) {
      const n = nb.list[k];
      if (d[n] < 0) {
        d[n] = d[c] + 1;
        queue.push(n);
      }
    }
  }
  return d;
}

/** Groups of connected cells for which `inside` is true. */
function groups(g: Graph, nb: Neighbors, inside: (c: number) => boolean) {
  const id = new Int32Array(g.cellCount).fill(-1);
  const out: number[][] = [];
  for (let c = 0; c < g.cellCount; c++) {
    if (id[c] >= 0 || !inside(c)) continue;
    const cells = [c];
    id[c] = out.length;
    for (let q = 0; q < cells.length; q++)
      for (let k = nb.start[cells[q]]; k < nb.start[cells[q] + 1]; k++) {
        const n = nb.list[k];
        if (id[n] < 0 && inside(n)) {
          id[n] = out.length;
          cells.push(n);
        }
      }
    out.push(cells);
  }
  return out;
}

/** Whether a cell touches the map's edge. */
function onBorder(g: Graph, c: number) {
  for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) if (across(g, g.cellEdges[k], c) < 0) return true;
  return false;
}

// ------------------------------------------------------------------ the generator

/**
 * Makes a map on the polygons `g` (a map `widthKm` wide and `heightKm` tall) with `settings`,
 * the same every time for the same seed. `variants` gives how many drawings each kind of icon has.
 */
export function generateMap(g: Graph, widthKm: number, heightKm: number, settings: GenSettings, seed: number, variants: (kind: TerrainKind) => number): GeneratedMap {
  const N = g.cellCount;
  const W = g.width;
  const H = g.height;
  const sp = g.spacing;
  const kmPerUnit = widthKm / W;
  const nb = neighborsOf(g);
  const rand = seededRandom(mixSeed(seed, 0x6e7));
  const noise = gradientNoise(mixSeed(seed, 1));
  const warp = gradientNoise(mixSeed(seed, 2));
  const detail = gradientNoise(mixSeed(seed, 3));
  const landShare = clamp(settings.land, 0.05, 0.85);
  const mountains = clamp(settings.mountains, 0, 1);
  const cx = (c: number) => g.centers[c * 2];
  const cy = (c: number) => g.centers[c * 2 + 1];
  const long = Math.max(W, H);

  // --- 1. Land
  // Landmasses: blobs, warped by noise so their coasts are uneven.
  const blobs: { x: number; y: number; r: number }[] = [];
  const area = landShare * W * H * 1.25;
  const count = settings.shape === 'continent' ? 1 : settings.shape === 'continents' ? 2 + Math.floor(rand() * 3) : 10 + Math.floor(rand() * 10);
  const weights = Array.from({ length: count }, () => 0.5 + rand());
  const total = weights.reduce((a, b) => a + b, 0);
  for (const wgt of weights) {
    const r = Math.sqrt((area * wgt) / total / Math.PI);
    let best = { x: W / 2, y: H / 2, r, score: -Infinity };
    // Spread them out: of a few tries, the one furthest from the others (and kept off the edges).
    for (let t = 0; t < (count === 1 ? 1 : 12); t++) {
      const m = Math.min(r * 0.7, Math.min(W, H) * 0.35);
      const x = count === 1 ? W * (0.4 + rand() * 0.2) : m + rand() * (W - 2 * m);
      const y = count === 1 ? H * (0.4 + rand() * 0.2) : m + rand() * (H - 2 * m);
      let score = blobs.length ? Infinity : 0;
      for (const b of blobs) score = Math.min(score, Math.hypot(b.x - x, b.y - y) - (b.r + r) * 0.6);
      // ...and not too far off to one side, so the land is spread over the map.
      score -= Math.hypot((x - W / 2) / W, (y - H / 2) / H) * long * 0.45;
      if (score > best.score) best = { x, y, r, score };
    }
    blobs.push(best);
  }
  const scale = settings.shape === 'islands' ? long / 5 : long / 3.2;
  const base = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const wx = cx(c) + fbm(warp, cx(c) / scale, cy(c) / scale, 3) * scale * 0.9;
    const wy = cy(c) + fbm(warp, cx(c) / scale + 31.7, cy(c) / scale - 12.9, 3) * scale * 0.9;
    let b = -1;
    for (const o of blobs) b = Math.max(b, 1 - Math.hypot(wx - o.x, wy - o.y) / o.r);
    base[c] = b;
  }

  // Plates, grown from random cells at random rates until they meet; each drifts its own way.
  const plateCount = settings.shape === 'islands' ? 18 : settings.shape === 'continents' ? 12 : 9;
  const plate = new Int16Array(N).fill(-1);
  const heap = new Heap();
  for (let p = 0; p < plateCount; p++) heap.push(0, Math.floor(rand() * N) * 64 + p);
  const growth = Array.from({ length: plateCount }, () => 0.6 + rand() * 0.8);
  while (heap.size) {
    const [d, v] = heap.pop();
    const c = Math.floor(v / 64);
    const p = v % 64;
    if (plate[c] >= 0) continue;
    plate[c] = p;
    for (let k = nb.start[c]; k < nb.start[c + 1]; k++) {
      const n = nb.list[k];
      if (plate[n] < 0) heap.push(d + (0.6 + rand() * 0.8) / growth[p], n * 64 + p);
    }
  }
  const drift = Array.from({ length: plateCount }, () => {
    const a = rand() * Math.PI * 2;
    const s = 0.3 + rand() * 0.7;
    return [Math.cos(a) * s, Math.sin(a) * s];
  });
  // Where plates push together hard enough the ground rises in a ridge (more of them make
  // ranges on a more mountainous map); where they pull apart it sinks a little.
  const pushFrom = 0.55 - 0.45 * mountains;
  const push = new Float32Array(N);
  const pull = new Float32Array(N);
  for (let c = 0; c < N; c++)
    for (let k = nb.start[c]; k < nb.start[c + 1]; k++) {
      const n = nb.list[k];
      if (plate[n] === plate[c]) continue;
      const dx = cx(n) - cx(c);
      const dy = cy(n) - cy(c);
      const len = Math.hypot(dx, dy) || 1;
      const a = drift[plate[c]];
      const b = drift[plate[n]];
      const rel = ((a[0] - b[0]) * dx + (a[1] - b[1]) * dy) / len;
      push[c] = Math.max(push[c], rel);
      pull[c] = Math.max(pull[c], -rel);
    }
  const ridge = new Float32Array(N);
  const rift = new Float32Array(N);
  const belt = sp * (2 + mountains * 1.2);
  for (let c = 0; c < N; c++) {
    const strength = (push[c] - pushFrom) / (1.4 - pushFrom);
    if (strength > 0)
      cellsNear(g, cx(c), cy(c), belt * 2.2, (n) => {
        const t = Math.hypot(cx(n) - cx(c), cy(n) - cy(c)) / belt;
        ridge[n] = Math.max(ridge[n], Math.min(1, 0.45 + strength) * Math.exp(-t * t));
      });
    if (pull[c] > 0.05)
      cellsNear(g, cx(c), cy(c), sp * 2.5, (n) => {
        const t = Math.hypot(cx(n) - cx(c), cy(n) - cy(c)) / (sp * 1.2);
        rift[n] = Math.max(rift[n], pull[c] * Math.exp(-t * t));
      });
  }
  // Break the ridges into peaks and saddles.
  for (let c = 0; c < N; c++) ridge[c] = Math.min(1, ridge[c]) * clamp(0.65 + fbm(detail, cx(c) / (sp * 6), cy(c) / (sp * 6), 3) * 1.4, 0, 1.15);

  const roughness = settings.shape === 'islands' ? 0.55 : 0.4;
  const raw = new Float32Array(N);
  const edge = Math.min(W, H) * 0.07;
  for (let c = 0; c < N; c++) {
    const e = Math.min(cx(c), cy(c), W - cx(c), H - cy(c));
    const edgeFall = e < edge ? (1 - e / edge) ** 2 * 0.8 : 0;
    raw[c] = base[c] + roughness * fbm(noise, cx(c) / (scale * 0.55), cy(c) / (scale * 0.55), 5) + ridge[c] * (0.15 + 0.25 * mountains) - rift[c] * 0.12 - edgeFall;
  }
  // The sea level that leaves the amount of land asked for above it.
  const sorted = Float32Array.from(raw).sort();
  const sea = sorted[Math.min(N - 1, Math.max(0, Math.floor(N * (1 - landShare))))];
  const land = new Uint8Array(N);
  for (let c = 0; c < N; c++) land[c] = raw[c] > sea ? 1 : 0;
  // Tidy: specks of land go under, puddles in the land are filled in.
  const minIsland = Math.max(3, Math.round(N * 0.0004));
  for (const cells of groups(g, nb, (c) => land[c] === 1)) if (cells.length < minIsland) for (const c of cells) land[c] = 0;
  for (const cells of groups(g, nb, (c) => land[c] === 0)) if (cells.length < 8 && !cells.some((c) => onBorder(g, c))) for (const c of cells) land[c] = 1;

  // --- 2. Elevation
  const coast = stepsFrom(g, nb, (c) => !land[c]);
  const above: number[] = [];
  for (let c = 0; c < N; c++) if (land[c]) above.push(raw[c] - sea);
  above.sort((a, b) => a - b);
  const top = above[Math.floor(above.length * 0.97)] || 1;
  const rangeHeight = 1000 + 4000 * mountains;
  const elevation = new Int16Array(N);
  for (let c = 0; c < N; c++) {
    if (!land[c]) continue;
    const a = clamp((raw[c] - sea) / top, 0, 1.3);
    const lowland = 40 + 620 * a ** 1.5;
    const inland = smoothstep(0, 3, coast[c]);
    const range = ridge[c] * rangeHeight * (0.75 + 0.5 * fbm(detail, cx(c) / (sp * 2.5), cy(c) / (sp * 2.5), 2)) * inland;
    elevation[c] = Math.round(clamp(lowland + range, 1, 8500));
  }

  // --- 3. Lakes: a few hollows inland filled with water (only on land well away from the sea).
  const landCells = above.length;
  const lakeCount = Math.min(14, Math.round(landCells / (settings.shape === 'islands' ? 2600 : 1600)));
  const lakeAt: number[] = [];
  const isLake = new Uint8Array(N);
  for (let tries = 0; lakeAt.length < lakeCount && tries < lakeCount * 40; tries++) {
    const c = Math.floor(rand() * N);
    if (!land[c] || coast[c] < 4 || elevation[c] > 1400 || ridge[c] > 0.35) continue;
    if (lakeAt.some((o) => Math.hypot(cx(o) - cx(c), cy(o) - cy(c)) < sp * 10)) continue;
    // Flood from the lowest cell nearby, lowest neighbors first.
    let low = c;
    cellsNear(g, cx(c), cy(c), sp * 3, (n) => land[n] && elevation[n] < elevation[low] && (low = n));
    const size = 3 + Math.floor(rand() * 12);
    const cells: number[] = [];
    const fill = new Heap();
    const seen = new Set<number>([low]);
    fill.push(elevation[low], low);
    while (fill.size && cells.length < size) {
      const [, n] = fill.pop();
      if (coast[n] < 3) break;
      cells.push(n);
      for (let k = nb.start[n]; k < nb.start[n + 1]; k++) {
        const m = nb.list[k];
        if (!seen.has(m) && land[m]) {
          seen.add(m);
          fill.push(elevation[m], m);
        }
      }
    }
    if (cells.length < 3) continue;
    lakeAt.push(low);
    for (const n of cells) isLake[n] = 1;
  }
  // The lake's surface sits at its lowest shore; the lake itself becomes water.
  const lakeLevel = new Int16Array(N);
  for (const cells of groups(g, nb, (c) => isLake[c] === 1)) {
    let level = Infinity;
    for (const c of cells)
      for (let k = nb.start[c]; k < nb.start[c + 1]; k++) {
        const n = nb.list[k];
        if (!isLake[n] && land[n]) level = Math.min(level, elevation[n]);
      }
    for (const c of cells) {
      lakeLevel[c] = Math.max(1, Math.round(level === Infinity ? elevation[c] : level) - 1);
      land[c] = 0;
      elevation[c] = 0;
    }
  }
  const water = stepsFrom(g, nb, (c) => !land[c]);

  // --- 4. Terrain icons, stored as if placed by hand.
  const icons: PlacedIcon[] = [];
  // Mountains, hills and volcanoes are sized by their polygon (src/lib/map/terrain.ts).
  const ratio = polygonScale(g);
  const covered = new Uint8Array(N);
  const variant = (kind: TerrainKind) => Math.floor(rand() * variants(kind));
  const cover = (x: number, y: number, r: number) => cellsNear(g, x, y, r, (c) => (covered[c] = 1));
  const pick = (ok: (c: number) => boolean, tries = 400) => {
    for (let t = 0; t < tries; t++) {
      const c = Math.floor(rand() * N);
      if (ok(c)) return c;
    }
    return -1;
  };
  // Plateaus: broad high ground away from the ranges.
  const plateaus = Math.round(mountains * 2 + rand() * 1.5 + (settings.shape === 'islands' ? -0.5 : 0));
  for (let i = 0; i < plateaus; i++) {
    const c = pick((c) => land[c] === 1 && !covered[c] && water[c] >= 4 && elevation[c] >= 350 && elevation[c] <= 2200 && ridge[c] < 0.25);
    if (c < 0) break;
    const size = KINDS.plateau.size * sp * (0.85 + rand() * 0.35);
    let high = 0;
    cellsNear(g, cx(c), cy(c), size * 0.5, (n) => (high = Math.max(high, elevation[n])));
    icons.push({ id: newId(), kind: 'plateau', x: cx(c), y: cy(c) + size * 0.15, size, variant: variant('plateau'), meters: Math.round(high + 250 + rand() * 350) });
    cover(cx(c), cy(c), size * 0.9);
  }
  // Cliffs, along polygon borders: escarpments inland, wandering one way, with the drop on the lower side.
  const cliffs: Cliff[] = [];
  const K0 = corners(g);
  const vx = (v: number) => g.vertices[v * 2];
  const vy = (v: number) => g.vertices[v * 2 + 1];
  const cornerOf = (c: number) => g.edges[g.cellEdges[g.cellEdgeStart[c]] * 4];
  const cellsOf = (v: number) => [0, 1, 2, 3].map((i) => K0.cells[v * 4 + i]).filter((c) => c >= 0);
  const inland = (v: number) => cellsOf(v).every((c) => land[c] && !covered[c] && water[c] >= 2);
  // Average elevation of the cells within 2 spacings on the right of a chain (the drop side) less that on its left.
  const rightIsLower = (chain: number[]) => {
    let right = 0;
    let left = 0;
    let nr = 0;
    let nl = 0;
    for (let i = 1; i < chain.length; i++) {
      const [ax, ay, bx, by] = [vx(chain[i - 1]), vy(chain[i - 1]), vx(chain[i]), vy(chain[i])];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
      cellsNear(g, (ax + bx) / 2, (ay + by) / 2, sp * 2, (c) => {
        if (!land[c]) return;
        const side = (cx(c) - (ax + bx) / 2) * nx + (cy(c) - (ay + by) / 2) * ny;
        if (side > 0) {
          right += elevation[c];
          nr++;
        } else {
          left += elevation[c];
          nl++;
        }
      });
    }
    return right / (nr || 1) <= left / (nl || 1);
  };
  const walk = (start: number, length: number, ok: (from: number, to: number) => boolean, wander: number) => {
    const chain = [start];
    const seen = new Set(chain);
    let heading = rand() * Math.PI * 2;
    for (let step = 0; step < length; step++) {
      const v = chain[chain.length - 1];
      let best = -1;
      let bs = -Infinity;
      for (let i = K0.start[v]; i < K0.start[v + 1]; i++) {
        const n = K0.next[i];
        if (seen.has(n) || !ok(v, n)) continue;
        const a = Math.atan2(vy(n) - vy(v), vx(n) - vx(v));
        const score = Math.cos(a - heading) + rand() * 0.3;
        if (score > bs) {
          bs = score;
          best = n;
        }
      }
      if (best < 0 || bs < -0.2) break;
      heading = Math.atan2(vy(best) - vy(v), vx(best) - vx(v)) * 0.5 + heading * 0.5 + (rand() - 0.5) * wander;
      chain.push(best);
      seen.add(best);
    }
    return chain;
  };
  const coverChain = (chain: number[]) => {
    for (const v of chain) for (const c of cellsOf(v)) covered[c] = 1;
  };
  const escarpments = Math.round(mountains * 1.5 + rand() * 2);
  for (let i = 0; i < escarpments; i++) {
    const c = pick((c) => land[c] === 1 && !covered[c] && water[c] >= 3 && elevation[c] <= 1500 && ridge[c] < 0.3);
    if (c < 0) break;
    const chain = walk(cornerOf(c), 8 + Math.floor(rand() * 12), (_, n) => inland(n), 0.5);
    if (chain.length < 6) continue;
    cliffs.push({ id: newId(), vertices: rightIsLower(chain) ? chain : [...chain].reverse(), meters: Math.round(150 + rand() * 350) });
    coverChain(chain);
  }
  // Sea cliffs: along a stretch of the shore of the sea or a lake, dropping to the water (Caleb).
  // A few here; more are placed where rivers reach the water, once the rivers are made (below).
  const coastal = Math.round(rand() * 1.5);
  // The drop toward the water: on the right of a chain along the shore.
  const towardWater = (chain: number[]) => {
    const [a, b] = [chain[0], chain[1]];
    const wet = cellsOf(a).find((q) => !land[q] && cellsOf(b).includes(q));
    const [ax, ay, bx, by] = [vx(a), vy(a), vx(b), vy(b)];
    const toWater = wet === undefined ? 0 : (cx(wet) - (ax + bx) / 2) * -(by - ay) + (cy(wet) - (ay + by) / 2) * (bx - ax);
    return toWater >= 0 ? chain : [...chain].reverse();
  };
  const shoreEdge = (a: number, b: number) => {
    for (let i = K0.start[a]; i < K0.start[a + 1]; i++) {
      if (K0.next[i] !== b) continue;
      const e = K0.edge[i];
      const c0 = g.edges[e * 4 + 2];
      const c1 = g.edges[e * 4 + 3];
      return c0 >= 0 && c1 >= 0 && land[c0] !== land[c1] && !covered[land[c0] ? c0 : c1];
    }
    return false;
  };
  for (let i = 0; i < coastal; i++) {
    const c = pick((c) => land[c] === 1 && !covered[c] && water[c] === 1 && elevation[c] >= 60);
    if (c < 0) break;
    // A corner of this cell on the shore.
    let start = -1;
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1] && start < 0; k++) {
      const e = g.cellEdges[k];
      const o = across(g, e, c);
      if (o >= 0 && !land[o]) start = g.edges[e * 4];
    }
    if (start < 0) continue;
    const chain = walk(start, 6 + Math.floor(rand() * 9), shoreEdge, 1.2);
    if (chain.length < 5) continue;
    cliffs.push({ id: newId(), vertices: towardWater(chain), meters: Math.round(80 + rand() * 220) });
    coverChain(chain);
  }
  // Volcanoes: a few, on high ground near a coast where plates push together, or alone on islands.
  const volcanoes = Math.round((settings.shape === 'islands' ? 1.5 : 0.5) + mountains * 1.5 + rand() * 1.5);
  for (let i = 0; i < volcanoes; i++) {
    const c = pick((c) => land[c] === 1 && !covered[c] && water[c] >= 2 && water[c] <= 8 && (ridge[c] > 0.3 || settings.shape === 'islands') && elevation[c] >= 300);
    if (c < 0) break;
    const size = KINDS.volcano.size * sp * ratio[c] * (0.85 + rand() * 0.3);
    icons.push({ id: newId(), kind: 'volcano', x: cx(c), y: cy(c) + footOffset('volcano', size, sp), size, variant: variant('volcano'), meters: Math.max(elevation[c] + 600, 1800 + Math.round(rand() * 1500)) });
    cover(cx(c), cy(c), size * 0.45);
  }
  // Mountains and hills along the high ground, spaced across each range (as Nortantis does).
  const MOUNTAIN_FROM = 1500;
  const HILL_FROM = 450;
  const bucket = sp * 7;
  const cols = Math.ceil(W / bucket) + 1;
  const grid = new Map<number, { x: number; y: number; w: number; f: number }[]>();
  const keep = (x: number, y: number, w: number, f: number) => {
    const k = Math.floor(y / bucket) * cols + Math.floor(x / bucket);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push({ x, y, w, f });
  };
  const roomFor = (x: number, y: number, w: number, f: number) => {
    const bx = Math.floor(x / bucket);
    const by = Math.floor(y / bucket);
    for (let j = by - 1; j <= by + 1; j++)
      for (let i = bx - 1; i <= bx + 1; i++) for (const o of grid.get(j * cols + i) ?? []) if (Math.hypot(o.x - x, o.y - y) < Math.max(f, o.f) * (w + o.w) * 0.5) return false;
    return true;
  };
  for (const p of icons) if (p.kind === 'volcano') keep(p.x, p.y, p.size, 0.6);
  const candidates: { c: number; key: number }[] = [];
  for (let c = 0; c < N; c++) {
    if (!land[c] || covered[c] || water[c] < 1) continue;
    // Hills only where the ground is rough (on and around the ranges), not on every rise.
    if (elevation[c] >= MOUNTAIN_FROM || (elevation[c] >= HILL_FROM && ridge[c] > 0.2)) candidates.push({ c, key: rand() });
  }
  candidates.sort((a, b) => a.key - b.key);
  for (const { c } of candidates) {
    const mountain = elevation[c] >= MOUNTAIN_FROM;
    const kind = mountain ? 'mountain' : 'hill';
    const w = KINDS[kind].size * sp * ratio[c];
    const f = mountain ? 0.42 : 0.6;
    const x = cx(c) + (rand() - 0.5) * 0.4 * sp;
    const y = cy(c) + (rand() - 0.5) * 0.4 * sp + sp * (mountain ? 0.35 : 0.25);
    if (!roomFor(x, y, w, f)) continue;
    keep(x, y, w, f);
    icons.push({ id: newId(), kind, x, y, size: w, variant: variant(kind), meters: elevation[c] });
  }

  // --- 5. Rivers
  const heights = computeHeights(g, land, elevation, icons, cliffs);
  // Moisture before rivers (rain): from the sea, less inland and behind mountains (winds from the west).
  const seaSteps = stepsFrom(g, nb, (c) => !land[c] && !isLake[c]);
  const wet = gradientNoise(mixSeed(seed, 4));
  const rain = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    if (!land[c]) continue;
    const km = Math.max(0, seaSteps[c]) * sp * kmPerUnit;
    let shadow = 0;
    for (let k = 1; k <= 8; k++) {
      const up = cellAt(g, cx(c) - k * sp * 1.5, cy(c));
      if (up >= 0 && heights[up] - heights[c] > 900) shadow = Math.max(shadow, 1 - k / 10);
    }
    rain[c] = clamp(0.12 + 0.65 * Math.exp(-km / 500) + 0.4 * fbm(wet, cx(c) / (long / 4), cy(c) / (long / 4), 3) - 0.35 * shadow, 0.05, 1);
  }
  // Water runs downhill, through lakes (a lake counts as land at its surface for this).
  const flowLand = new Uint8Array(N);
  const flowHeights = new Int16Array(N);
  for (let c = 0; c < N; c++) {
    flowLand[c] = land[c] || isLake[c] ? 1 : 0;
    flowHeights[c] = isLake[c] ? lakeLevel[c] : heights[c];
  }
  // ...along the borders between polygons, from corner to corner (rivers follow borders, as in Nortantis).
  const K = corners(g);
  const V = K.count;
  const down = drainage(g, flowLand, flowHeights, cliffs);
  // Rain falls on each polygon and is shared among its corners.
  const gathered = new Float32Array(V);
  for (let c = 0; c < N; c++) {
    if (!flowLand[c]) continue;
    const edges = g.cellEdgeStart[c + 1] - g.cellEdgeStart[c];
    const share = (isLake[c] ? 0.6 : rain[c]) / edges / 2;
    for (let e = g.cellEdgeStart[c]; e < g.cellEdgeStart[c + 1]; e++) {
      gathered[g.edges[g.cellEdges[e] * 4]] += share;
      gathered[g.edges[g.cellEdges[e] * 4 + 1]] += share;
    }
  }
  const into = new Int32Array(V);
  for (let v = 0; v < V; v++) if (down[v] >= 0) into[down[v]]++;
  const queue: number[] = [];
  for (let v = 0; v < V; v++) if (down[v] !== -3 && into[v] === 0) queue.push(v);
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    const d = down[v];
    if (d < 0) continue;
    gathered[d] += gathered[v];
    if (--into[d] === 0) queue.push(d);
  }
  // A river where enough water has gathered: about twenty cells' worth of rain.
  const threshold = 22;
  const isRiver = (v: number) => down[v] !== -3 && gathered[v] >= threshold;
  const upstream = new Map<number, number[]>();
  for (let v = 0; v < V; v++)
    if (isRiver(v) && down[v] >= 0) {
      const list = upstream.get(down[v]);
      if (list) list.push(v);
      else upstream.set(down[v], [v]);
    }
  // Each river from its mouth (or where it joins a bigger one) up its largest branch to its source.
  type Traced = { corners: number[]; join: number; tribs: number[] };
  const traced: Traced[] = [];
  const traceFrom = (start: number, join: number) => {
    const path = [start];
    const tribs: number[] = [];
    let v = start;
    for (;;) {
      const ups = upstream.get(v);
      if (!ups || !ups.length) break;
      let main = ups[0];
      for (const u of ups) if (gathered[u] > gathered[main]) main = u;
      for (const u of ups) if (u !== main) tribs.push(u);
      v = main;
      path.push(v);
    }
    traced.push({ corners: path.reverse(), join, tribs });
  };
  for (let v = 0; v < V; v++) if (isRiver(v) && down[v] < 0) traceFrom(v, -1);
  for (let i = 0; i < traced.length; i++) for (const t of traced[i].tribs) traceFrom(t, down[t]);
  // Where a river reaches a lake it ends at the shore, and another starts where the water flows
  // out (rather than running along the lake's edge, where it would show as a strip by the shore).
  const touchesLake = (v: number) => {
    for (let q = 0; q < 4; q++) if (K.cells[v * 4 + q] >= 0 && isLake[K.cells[v * 4 + q]]) return true;
    return false;
  };
  const pieces: { corners: number[]; tribs: number[] }[] = [];
  for (const t of traced) {
    const path = t.join >= 0 ? [...t.corners, t.join] : t.corners;
    let piece: number[] = [];
    for (let i = 0; i < path.length; i++) {
      const v = path[i];
      if (!touchesLake(v)) {
        piece.push(v);
        continue;
      }
      // Into the lake: this piece ends at the shore; the next starts at the last shore corner before land again.
      piece.push(v);
      if (piece.length >= 2) pieces.push({ corners: piece, tribs: t.tribs });
      let j = i;
      while (j + 1 < path.length && touchesLake(path[j + 1])) j++;
      piece = [path[j]];
      i = j;
    }
    if (piece.length >= 2) pieces.push({ corners: piece, tribs: t.tribs });
  }
  const rivers: River[] = [];
  let biggest = 0;
  for (const p of pieces) biggest = Math.max(biggest, gathered[p.corners[p.corners.length - 1]]);
  const k = (sp * 0.45) / Math.sqrt(biggest || 1);
  // Short ones are left out (a border is a little over half a cell long).
  const kept = pieces.filter((p) => p.corners.length >= 6);
  const keptMouths = new Set(kept.map((p) => p.corners[p.corners.length - 1]));
  for (const p of kept) {
    const last = p.corners[p.corners.length - 1];
    // The water it carries of its own: all that gathered at its mouth, less what the rivers joining it bring.
    const on = new Set(p.corners.slice(0, -1));
    let own = gathered[last];
    for (const q of kept) {
      const m = q.corners[q.corners.length - 1];
      if (q !== p && on.has(m) && keptMouths.has(m)) own -= gathered[q.corners[q.corners.length - 2]];
    }
    rivers.push({ id: newId(), vertices: p.corners, width: Math.max(sp * 0.05, k * Math.sqrt(Math.max(own, 1))) });
  }

  // Sea cliffs where some of the bigger rivers reach the sea or a lake, so they fall into the
  // water (Caleb): along the shore either side of the river's mouth. (Placed once the rivers are
  // made, so they do not turn the rivers aside.)
  const falls = Math.round(1 + mountains * 2 + rand() * 2);
  const byWidth = [...rivers].sort((a, b) => b.width - a.width);
  let placedFalls = 0;
  for (const r of byWidth) {
    if (placedFalls >= falls) break;
    const mouth = r.vertices[r.vertices.length - 1];
    const before = r.vertices[r.vertices.length - 2];
    const shore = cellsOf(mouth);
    if (!shore.some((c) => land[c]) || !shore.some((c) => !land[c]) || rand() < 0.35) continue;
    // Along the shore both ways from the mouth.
    const along = (from: number, not: Set<number>, steps: number) => {
      const out: number[] = [];
      let v = from;
      for (let k = 0; k < steps; k++) {
        let next = -1;
        for (let i = K0.start[v]; i < K0.start[v + 1] && next < 0; i++) {
          const n = K0.next[i];
          if (!not.has(n) && shoreEdge(v, n)) next = n;
        }
        if (next < 0) break;
        out.push(next);
        not.add(next);
        v = next;
      }
      return out;
    };
    const seen = new Set([mouth, before]);
    const left = along(mouth, seen, 2 + Math.floor(rand() * 4));
    const right = along(mouth, seen, 2 + Math.floor(rand() * 4));
    const chain = [...left.reverse(), mouth, ...right];
    if (chain.length < 4 || r.vertices.slice(0, -1).some((v) => chain.includes(v))) continue;
    cliffs.push({ id: newId(), vertices: towardWater(chain), meters: Math.round(80 + rand() * 220) });
    coverChain(chain);
    placedFalls++;
  }

  // --- 6. Biomes
  // Polygons a river runs beside.
  const byRiver = new Uint8Array(N);
  for (const r of rivers) for (const v of r.vertices) for (let i = 0; i < 4; i++) if (K.cells[v * 4 + i] >= 0) byRiver[K.cells[v * 4 + i]] = 1;
  const nearWater = stepsFrom(g, nb, (c) => isLake[c] === 1 || byRiver[c] === 1);
  const baseTemp = -6 + 40 * clamp(settings.climate, 0, 1);
  const spread = heightKm * 0.007;
  const swampy = gradientNoise(mixSeed(seed, 6));
  const biome = new Uint8Array(N);
  for (let c = 0; c < N; c++) {
    if (!land[c]) continue;
    const t = baseTemp + (cy(c) / H - 0.5) * spread - (6.5 * heights[c]) / 1000;
    const m = clamp(rain[c] + (nearWater[c] >= 0 && nearWater[c] <= 1 ? 0.2 : nearWater[c] === 2 ? 0.1 : 0), 0, 1);
    let b: BiomeName;
    if (t < -4) b = 'Ice';
    else if (t < 2) b = 'Tundra';
    else if (t < 8) b = m > 0.3 ? 'Pine forest' : 'Tundra';
    else if (t < 21) b = m < 0.2 ? (t > 14 ? 'Desert' : 'Grassland') : m < 0.42 ? 'Grassland' : t < 10 && m > 0.5 ? 'Pine forest' : 'Forest';
    else b = m < 0.25 ? 'Desert' : m < 0.42 ? 'Grassland' : m < 0.68 ? 'Forest' : 'Jungle';
    if (t > 4 && m > 0.62 && heights[c] < 260 && nearWater[c] >= 0 && nearWater[c] <= 2 && swampy(cx(c) / (sp * 5), cy(c) / (sp * 5)) > 0.12) b = 'Swamp';
    biome[c] = BIOME(b);
  }
  // Even out lone cells: a cell none of whose neighbors shares its biome takes its neighbors' most common one.
  const tally = new Map<number, number>();
  for (let c = 0; c < N; c++) {
    if (!land[c]) continue;
    tally.clear();
    let same = 0;
    for (let k = nb.start[c]; k < nb.start[c + 1]; k++) {
      const n = nb.list[k];
      if (!land[n]) continue;
      if (biome[n] === biome[c]) same++;
      tally.set(biome[n], (tally.get(biome[n]) ?? 0) + 1);
    }
    if (same === 0 && tally.size) biome[c] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return { land, biome, elevation, icons, rivers, cliffs };
}
