import { mixSeed, seededRandom } from '../rng';
import type { CliffShape, IconKind, PlacedIcon, TerrainKind } from '../world/types';
import { across, cellAt, cellsNear, type Graph } from './graph';

// Elevation (Stage 4). The ground has a painted base elevation (meters, land only; the
// coast stays where it was painted). Terrain icons placed by hand shape it on top, and
// win over it: "icons come before elevation". From the final heights, the app puts hills
// and mountains wherever the ground is high and no icon was placed by hand.

/** New land starts as low plains. */
export const DEFAULT_LAND_ELEVATION = 100;
export const ELEVATION_MAX = 9000;
/** Above these heights the app draws hills and mountains by itself. */
export const HILL_FROM = 500;
export const MOUNTAIN_FROM = 1500;

/**
 * How mountains and hills the app draws are sized, as Nortantis sizes its own: each is
 * scaled by its polygon's width between its neighbors over the map's average. Our polygons
 * are evened out more than Nortantis's (two relaxation passes to its one), so they vary
 * about a fifth less; the ratio is stretched by 1.21 so sizes vary as much as there
 * (measured: 5% of cells at 0.59, 1% at 1.65, as in Nortantis). Odd cells along the map's
 * border are kept within 0.45 to 1.9.
 */
const SIZE_STRETCH = 1.21;
const SIZE_MIN = 0.45;
const SIZE_MAX = 1.9;
/** Mountains the app draws are spaced so their centers are at least this many of their widths apart (they overlap by about a third). Hills a little more. */
const MOUNTAIN_SPACING = 0.42;
const HILL_SPACING = 0.6;

type Effect = 'raise' | 'flat' | 'step' | 'none';

export interface KindInfo {
  label: string;
  group: 'terrain' | 'plants';
  effect: Effect;
  /** Cliffs have a direction. */
  rotatable: boolean;
  /** What the meters mean, and the default. */
  meters?: { label: string; value: number };
  /** Default width in cell spacings. */
  size: number;
}

/**
 * Widths are in cell spacings. Mountains are 5.5 (Caleb's pick after comparing 2.75, 4 and
 * 5.5 on the map); hills, volcanoes, plateaus and cliffs keep their size relative to them.
 * Plants are half the size they were first drawn at next to a 2.75-spacing mountain.
 */
export const KINDS: Record<IconKind, KindInfo> = {
  mountain: { label: 'Mountain', group: 'terrain', effect: 'raise', rotatable: false, meters: { label: 'Peak', value: 2500 }, size: 5.5 },
  hill: { label: 'Hill', group: 'terrain', effect: 'raise', rotatable: false, meters: { label: 'Top', value: 700 }, size: 2.8 },
  volcano: { label: 'Volcano', group: 'terrain', effect: 'raise', rotatable: false, meters: { label: 'Peak', value: 3000 }, size: 5.8 },
  plateau: { label: 'Plateau', group: 'terrain', effect: 'flat', rotatable: false, meters: { label: 'Top', value: 1200 }, size: 6 },
  cliff: { label: 'Cliff', group: 'terrain', effect: 'step', rotatable: true, meters: { label: 'Drop', value: 300 }, size: 5 },
  deciduous: { label: 'Leafy tree', group: 'plants', effect: 'none', rotatable: false, size: 0.55 },
  pine: { label: 'Pine tree', group: 'plants', effect: 'none', rotatable: false, size: 0.6 },
  jungle: { label: 'Palm tree', group: 'plants', effect: 'none', rotatable: false, size: 0.58 },
  cactus: { label: 'Cactus', group: 'plants', effect: 'none', rotatable: false, size: 0.48 },
  shrub: { label: 'Shrub', group: 'plants', effect: 'none', rotatable: false, size: 0.37 },
  grass: { label: 'Grass', group: 'plants', effect: 'none', rotatable: false, size: 0.36 },
  dunes: { label: 'Dunes', group: 'plants', effect: 'none', rotatable: false, size: 1.2 },
  reeds: { label: 'Reeds', group: 'plants', effect: 'none', rotatable: false, size: 0.43 },
};

export const isTerrain = (k: IconKind): k is TerrainKind => KINDS[k].group === 'terrain';

/** A cliff's direction is the compass direction its drop faces (180 = south, toward the viewer); its drawing is turned by that minus 180. */
export const cliffTurn = (icon: { angle?: number }) => (icon.angle ?? 180) - 180;

/** How a cliff's drop changes along its length (u from -0.5 at its left end to 0.5 at its right, seen with the drop toward the viewer). */
function cliffAlong(shape: CliffShape | undefined, u: number) {
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  if (shape === 'taper-left') return smooth((u + 0.45) / 0.77);
  if (shape === 'taper-right') return smooth((0.45 - u) / 0.77);
  return 1;
}

/** Smooth fall-off: 1 at the center, 0 at t = 1. */
const fall = (t: number) => (t >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t)));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where an icon's effect on the ground is centered: a little above its ground point, under the middle of the drawing. */
function effectCenter(icon: PlacedIcon) {
  return KINDS[icon.kind].rotatable ? { x: icon.x, y: icon.y } : { x: icon.x, y: icon.y - icon.size * 0.22 };
}

/** How far an icon's effect reaches, in map units. */
export function effectRadius(icon: PlacedIcon) {
  const info = KINDS[icon.kind];
  if (info.effect === 'none') return 0;
  if (info.rotatable) return icon.size * 0.6;
  if (info.effect === 'flat') return icon.size * 0.8;
  return icon.size * 0.75;
}

/**
 * The final elevation of every cell: the painted base, then cliffs stepped, and hills,
 * mountains, volcanoes and plateaus raised last, so the ground under them reads at least
 * their height. Water cells read 0.
 */
export function computeHeights(g: Graph, land: Uint8Array, base: Int16Array, icons: PlacedIcon[]): Int16Array {
  const h = new Float32Array(g.cellCount);
  for (let c = 0; c < g.cellCount; c++) h[c] = land[c] ? base[c] : 0;
  const order: Effect[] = ['step', 'raise', 'flat'];
  for (const effect of order)
    for (const icon of icons) {
      const info = KINDS[icon.kind];
      if (info.effect !== effect) continue;
      const meters = icon.meters ?? info.meters?.value ?? 0;
      const center = effectCenter(icon);
      const R = effectRadius(icon);
      const a = (cliffTurn(icon) * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      cellsNear(g, center.x, center.y, R, (c) => {
        if (!land[c]) return;
        const dx = g.centers[c * 2] - center.x;
        const dy = g.centers[c * 2 + 1] - center.y;
        if (effect === 'raise') h[c] = Math.max(h[c], meters * fall(Math.hypot(dx, dy) / R));
        else if (effect === 'flat') h[c] = Math.max(h[c], meters * (1 - smoothstep(R * 0.6, R, Math.hypot(dx, dy))));
        else {
          // Cliff: along its line (u) and across it (v, toward the drop). The ground on the
          // high side is higher by the drop, fading out toward the ends, and toward one end for
          // a tapering cliff.
          const u = dx * ca + dy * sa;
          const v = -dx * sa + dy * ca;
          const along = (1 - smoothstep(icon.size * 0.4, icon.size * 0.5, Math.abs(u))) * cliffAlong(icon.shape, u / icon.size);
          const w = icon.size * 0.12;
          h[c] = h[c] + meters * along * (1 - smoothstep(-w, w, v));
        }
      });
      // The polygon right under a hill, mountain or volcano reads its full height, wherever its center is.
      if (effect === 'raise') {
        const peak = cellAt(g, center.x, center.y);
        if (peak >= 0 && land[peak]) h[peak] = Math.max(h[peak], meters);
      }
    }
  const out = new Int16Array(g.cellCount);
  for (let c = 0; c < g.cellCount; c++) out[c] = Math.round(Math.min(ELEVATION_MAX, Math.max(0, h[c])));
  return out;
}

const widthCache = new WeakMap<Graph, Float32Array>();

/** Each cell's size relative to the map's average, as Nortantis measures it: the width between its east-most and west-most neighbors. */
function cellSizeRatio(g: Graph): Float32Array {
  const hit = widthCache.get(g);
  if (hit) return hit;
  const w = new Float32Array(g.cellCount);
  let sum = 0;
  for (let c = 0; c < g.cellCount; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
      const n = across(g, g.cellEdges[k], c);
      if (n < 0) continue;
      lo = Math.min(lo, g.centers[n * 2]);
      hi = Math.max(hi, g.centers[n * 2]);
    }
    w[c] = hi > lo ? hi - lo : 0;
    sum += w[c];
  }
  const mean = sum / g.cellCount || 1;
  for (let c = 0; c < g.cellCount; c++) w[c] = Math.max(SIZE_MIN, Math.min(SIZE_MAX, 1 + SIZE_STRETCH * (w[c] / mean - 1)));
  widthCache.set(g, w);
  return w;
}

/** The key that names the hill or mountain the app draws on a cell (see MapInfo.hiddenAuto). */
export const autoTerrainKey = (cell: number) => `t${cell}`;

/** A hill or mountain the app drew by itself because the ground is high. */
export interface AutoTerrain {
  x: number;
  y: number;
  size: number;
  kind: 'hill' | 'mountain';
  variant: number;
  key: string;
}

/**
 * Hills and mountains drawn where the ground is high enough: hills from 500 m, mountains from
 * 1,500 m. Each is sized by its polygon, as in Nortantis, and they are spaced out across a
 * range (in a fixed random order, so the same ones are chosen every time), overlapping by
 * about a third. Hills, mountains and volcanoes placed by hand take part in the spacing; none
 * are drawn on a plateau or along a cliff placed by hand, or where Caleb took one over.
 * Also returns which cells hold terrain, so plants (biome icons) are not drawn there.
 */
export function autoTerrain(
  g: Graph,
  land: Uint8Array,
  heights: Int16Array,
  icons: PlacedIcon[],
  seed: number,
  variants: (kind: 'hill' | 'mountain') => number,
  hidden: ReadonlySet<string>,
): { icons: AutoTerrain[]; noPlants: Uint8Array } {
  const covered = new Uint8Array(g.cellCount);
  // Spacing: everything chosen so far, in a grid of buckets for quick neighbor checks.
  const bucket = g.spacing * 7;
  const cols = Math.ceil(g.width / bucket) + 1;
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
      for (let i = bx - 1; i <= bx + 1; i++)
        for (const o of grid.get(j * cols + i) ?? []) if (Math.hypot(o.x - x, o.y - y) < Math.max(f, o.f) * (w + o.w) * 0.5) return false;
    return true;
  };
  for (const icon of icons) {
    const info = KINDS[icon.kind];
    if (info.effect === 'raise') {
      keep(icon.x, icon.y, icon.size, icon.kind === 'hill' ? HILL_SPACING : icon.kind === 'volcano' ? 0.6 : MOUNTAIN_SPACING);
      continue;
    }
    if (info.effect === 'flat') {
      const c = effectCenter(icon);
      cellsNear(g, c.x, c.y, effectRadius(icon) * 0.9, (cell) => (covered[cell] = 1));
      continue;
    }
    if (info.effect !== 'step') continue;
    // A cliff clears the hills and mountains along it, so it is not buried under them.
    const a = (cliffTurn(icon) * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    cellsNear(g, icon.x, icon.y, icon.size * 0.55, (cell) => {
      const dx = g.centers[cell * 2] - icon.x;
      const dy = g.centers[cell * 2 + 1] - icon.y;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (Math.hypot(u / (icon.size * 0.55), v / (icon.size * 0.2 + g.spacing * 0.5)) < 1) covered[cell] = 1;
    });
  }
  const ratio = cellSizeRatio(g);
  const candidates: { c: number; key: number }[] = [];
  const noPlants = covered.slice();
  for (let c = 0; c < g.cellCount; c++) {
    if (!land[c] || heights[c] < HILL_FROM) continue;
    noPlants[c] = 1;
    if (covered[c] || hidden.has(autoTerrainKey(c))) continue;
    candidates.push({ c, key: seededRandom(mixSeed(seed ^ 0x51ed270b, c))() });
  }
  candidates.sort((a, b) => a.key - b.key);
  const out: AutoTerrain[] = [];
  for (const { c } of candidates) {
    const mountain = heights[c] >= MOUNTAIN_FROM;
    const kind = mountain ? 'mountain' : 'hill';
    const w = KINDS[kind].size * g.spacing * ratio[c];
    const f = mountain ? MOUNTAIN_SPACING : HILL_SPACING;
    const rand = seededRandom(mixSeed(seed ^ 0x2c1b3c6d, c));
    const x = g.centers[c * 2] + (rand() - 0.5) * 0.4 * g.spacing;
    const y = g.centers[c * 2 + 1] + (rand() - 0.5) * 0.4 * g.spacing + g.spacing * (mountain ? 0.35 : 0.25);
    if (!roomFor(x, y, w, f)) continue;
    keep(x, y, w, f);
    out.push({ x, y, size: w, kind, variant: Math.floor(rand() * variants(kind)), key: autoTerrainKey(c) });
  }
  return { icons: out, noPlants };
}
