import type { Cliff, IconKind, PlacedIcon, TerrainKind } from '../world/types';
import type { Dir } from './art/frame';
import { SETTLEMENT_SIZE } from './art/settlements';
import { cliffSteps } from './cliffs';
import { across, cellAt, cellsNear, type Graph } from './graph';

// Elevation (Stage 4). The ground has a painted base elevation (meters, land only; the
// coast stays where it was painted). Terrain icons placed by hand shape it on top, and
// win over it: "icons come before elevation". The app does not place icons from the
// elevation (Caleb took that out after trying it): only icons placed by hand are drawn.
// Cliffs, lines along polygon borders, step the ground (see cliffs.ts).

/** New land starts as low plains. */
export const DEFAULT_LAND_ELEVATION = 100;
export const ELEVATION_MAX = 9000;
type Effect = 'raise' | 'flat' | 'none';

export interface KindInfo {
  label: string;
  group: 'terrain' | 'plants' | 'water' | 'settlements';
  effect: Effect;
  /** Waterfalls fall toward one of 8 directions. */
  directional: boolean;
  /** What the meters mean, and the default. */
  meters?: { label: string; value: number };
  /** Default width in cell spacings. */
  size: number;
}

/**
 * Widths are in cell spacings. Mountains are 5.5 (Caleb's pick after comparing 2.75, 4 and
 * 5.5 on the map); hills, volcanoes and plateaus keep their size relative to them. Plants are
 * half the size they were first drawn at next to a 2.75-spacing mountain.
 */
export const KINDS: Record<IconKind, KindInfo> = {
  mountain: { label: 'Mountain', group: 'terrain', effect: 'raise', directional: false, meters: { label: 'Peak', value: 2500 }, size: 5.5 },
  hill: { label: 'Hill', group: 'terrain', effect: 'raise', directional: false, meters: { label: 'Top', value: 700 }, size: 2.8 },
  volcano: { label: 'Volcano', group: 'terrain', effect: 'raise', directional: false, meters: { label: 'Peak', value: 3000 }, size: 5.8 },
  plateau: { label: 'Plateau', group: 'terrain', effect: 'flat', directional: false, meters: { label: 'Top', value: 1200 }, size: 6 },
  deciduous: { label: 'Leafy tree', group: 'plants', effect: 'none', directional: false, size: 0.55 },
  pine: { label: 'Pine tree', group: 'plants', effect: 'none', directional: false, size: 0.6 },
  jungle: { label: 'Palm tree', group: 'plants', effect: 'none', directional: false, size: 0.58 },
  cactus: { label: 'Cactus', group: 'plants', effect: 'none', directional: false, size: 0.48 },
  shrub: { label: 'Shrub', group: 'plants', effect: 'none', directional: false, size: 0.37 },
  grass: { label: 'Grass', group: 'plants', effect: 'none', directional: false, size: 0.36 },
  dunes: { label: 'Dunes', group: 'plants', effect: 'none', directional: false, size: 1.2 },
  reeds: { label: 'Reeds', group: 'plants', effect: 'none', directional: false, size: 0.43 },
  waterfall: { label: 'Waterfall', group: 'water', effect: 'none', directional: true, size: 1.5 },
  // Settlements (Stage 8): fixed sizes (Caleb), not by polygon.
  farm: { label: 'Farm', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.farm },
  village: { label: 'Village', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.village },
  town: { label: 'Town', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.town },
  city: { label: 'City', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.city },
  'walled-city': { label: 'Walled city', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.walledCity },
  castle: { label: 'Castle', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.castle },
  port: { label: 'Port', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.port },
  ruins: { label: 'Ruins', group: 'settlements', effect: 'none', directional: false, size: SETTLEMENT_SIZE.ruins },
};

/** The roofs' color of a new settlement on the painterly map. */
export const DEFAULT_ROOF = '#a8553c';

export const isTerrain = (k: IconKind): k is TerrainKind => KINDS[k].group === 'terrain';

/** The nearest of the 8 compass directions to a waterfall's angle (0 N, 1 NE ... 7 NW); each has its own drawing. */
export const dirOf = (icon: { angle?: number }) => ((((Math.round((icon.angle ?? 180) / 45) % 8) + 8) % 8) as Dir);

/** Smooth fall-off: 1 at the center, 0 at t = 1. */
const fall = (t: number) => (t >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t)));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where an icon's effect on the ground is centered: a little above its ground point, under the middle of the drawing. */
function effectCenter(icon: PlacedIcon) {
  return { x: icon.x, y: icon.y - icon.size * 0.22 };
}

/** How far an icon's effect reaches, in map units. */
export function effectRadius(icon: PlacedIcon) {
  const info = KINDS[icon.kind];
  if (info.effect === 'none') return 0;
  if (info.effect === 'flat') return icon.size * 0.8;
  return icon.size * 0.75;
}

/**
 * The final elevation of every cell: the painted base, then the cliffs' steps, and hills,
 * mountains, volcanoes and plateaus raised last, so the ground under them reads at least
 * their height. Water cells read 0.
 */
export function computeHeights(g: Graph, land: Uint8Array, base: Int16Array, icons: PlacedIcon[], cliffs: Cliff[] = []): Int16Array {
  const h = new Float32Array(g.cellCount);
  for (let c = 0; c < g.cellCount; c++) h[c] = land[c] ? base[c] : 0;
  cliffSteps(g, land, cliffs, h);
  const order: Effect[] = ['raise', 'flat'];
  for (const effect of order)
    for (const icon of icons) {
      const info = KINDS[icon.kind];
      if (info.effect !== effect) continue;
      const meters = icon.meters ?? info.meters?.value ?? 0;
      const center = effectCenter(icon);
      const R = effectRadius(icon);
      cellsNear(g, center.x, center.y, R, (c) => {
        if (!land[c]) return;
        const dx = g.centers[c * 2] - center.x;
        const dy = g.centers[c * 2 + 1] - center.y;
        if (effect === 'raise') h[c] = Math.max(h[c], meters * fall(Math.hypot(dx, dy) / R));
        else h[c] = Math.max(h[c], meters * (1 - smoothstep(R * 0.6, R, Math.hypot(dx, dy))));
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

/**
 * Cells under a terrain icon or a settlement placed by hand: the plants of a biome (forest,
 * grass...) are not drawn there, so they do not crowd a mountain's slopes, a plateau's top or a town.
 */
export function underTerrain(g: Graph, icons: PlacedIcon[]): Uint8Array {
  const covered = new Uint8Array(g.cellCount);
  for (const icon of icons) {
    const info = KINDS[icon.kind];
    // A settlement: the ground it stands on.
    if (info.group === 'settlements') {
      cellsNear(g, icon.x, icon.y - icon.size * 0.2, icon.size * 0.42, (cell) => (covered[cell] = 1));
      continue;
    }
    if (info.effect === 'none') continue;
    if (info.effect === 'raise') {
      cellsNear(g, icon.x, icon.y - icon.size * 0.18, icon.size * 0.36, (cell) => (covered[cell] = 1));
      continue;
    }
    if (info.effect === 'flat') {
      const c = effectCenter(icon);
      cellsNear(g, c.x, c.y, effectRadius(icon) * 0.6, (cell) => (covered[cell] = 1));
    }
  }
  return covered;
}

// ------------------------------------------------------------------ icons and their polygons

/** Icons sized by the polygon they stand on, as Nortantis sizes its mountains: by hand and by the generator. */
export const SIZED_BY_POLYGON: ReadonlySet<IconKind> = new Set<IconKind>(['mountain', 'hill', 'volcano']);

/**
 * How strongly an icon's size follows its polygon's: a polygon's width (between its east-most
 * and west-most neighbors, as Nortantis measures it) over the map's average is stretched by
 * this much away from 1 (Caleb asked for more than Nortantis's own), and kept within the limits.
 */
const POLYGON_STRETCH = 1.7;
const POLYGON_SCALE_MIN = 0.4;
const POLYGON_SCALE_MAX = 2.3;
const scaleCache = new WeakMap<Graph, Float32Array>();

/** Each polygon's size factor for the icons sized by it (1 for an average polygon). */
export function polygonScale(g: Graph): Float32Array {
  const hit = scaleCache.get(g);
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
  for (let c = 0; c < g.cellCount; c++) w[c] = Math.max(POLYGON_SCALE_MIN, Math.min(POLYGON_SCALE_MAX, 1 + POLYGON_STRETCH * (w[c] / mean - 1)));
  scaleCache.set(g, w);
  return w;
}

/** How far below its polygon's middle an icon's ground point goes, so it stands on the polygon (map units). */
export function footOffset(kind: IconKind, size: number, spacing: number) {
  if (kind === 'mountain' || kind === 'volcano') return spacing * 0.35;
  if (kind === 'hill') return spacing * 0.25;
  if (kind === 'plateau') return size * 0.15;
  return 0;
}

/** The polygon an icon stands on (one icon per polygon when placing: see the Icons mode). */
export const iconCell = (g: Graph, icon: { kind: IconKind; x: number; y: number; size: number }) => cellAt(g, icon.x, icon.y - footOffset(icon.kind, icon.size, g.spacing));
