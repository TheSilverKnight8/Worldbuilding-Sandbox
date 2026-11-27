import { mixSeed, seededRandom } from '../rng';
import type { IconKind, PlacedIcon, TerrainKind } from '../world/types';
import { cellAt, cellsNear, type Graph } from './graph';

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
 * Icon widths in cell spacings, matched to Nortantis's defaults: there a mountain is about
 * 2.24 mean cell widths wide and a hill about 1.15 (its default icon widths times its
 * default mountain and hill scales), and here a cell is about 1.23 spacings wide. Higher
 * ground draws its mountains up to a fifth larger.
 */
export const MOUNTAIN_WIDTH = 2.75;
export const HILL_WIDTH = 1.4;

type Effect = 'raise' | 'flat' | 'lower' | 'step' | 'none';

export interface KindInfo {
  label: string;
  group: 'terrain' | 'plants';
  effect: Effect;
  /** Cliffs, canyons and valleys have a direction. */
  rotatable: boolean;
  /** What the meters mean, and the default. */
  meters?: { label: string; value: number };
  /** Default size in cell spacings. */
  size: number;
}

export const KINDS: Record<IconKind, KindInfo> = {
  hill: { label: 'Hill', group: 'terrain', effect: 'raise', rotatable: false, meters: { label: 'Top', value: 700 }, size: 1.45 },
  mountain: { label: 'Mountain', group: 'terrain', effect: 'raise', rotatable: false, meters: { label: 'Peak', value: 2500 }, size: 2.9 },
  volcano: { label: 'Volcano', group: 'terrain', effect: 'raise', rotatable: false, meters: { label: 'Peak', value: 3000 }, size: 3 },
  plateau: { label: 'Plateau', group: 'terrain', effect: 'flat', rotatable: false, meters: { label: 'Top', value: 1200 }, size: 3 },
  valley: { label: 'Valley', group: 'terrain', effect: 'lower', rotatable: true, meters: { label: 'Depth', value: 400 }, size: 4 },
  canyon: { label: 'Canyon', group: 'terrain', effect: 'lower', rotatable: true, meters: { label: 'Depth', value: 900 }, size: 3.5 },
  cliff: { label: 'Cliff', group: 'terrain', effect: 'step', rotatable: true, meters: { label: 'Drop', value: 300 }, size: 2.5 },
  pass: { label: 'Pass', group: 'terrain', effect: 'lower', rotatable: false, meters: { label: 'Depth', value: 600 }, size: 2 },
  deciduous: { label: 'Leafy tree', group: 'plants', effect: 'none', rotatable: false, size: 1.1 },
  pine: { label: 'Pine tree', group: 'plants', effect: 'none', rotatable: false, size: 1.2 },
  jungle: { label: 'Palm tree', group: 'plants', effect: 'none', rotatable: false, size: 1.15 },
  cactus: { label: 'Cactus', group: 'plants', effect: 'none', rotatable: false, size: 0.95 },
  shrub: { label: 'Shrub', group: 'plants', effect: 'none', rotatable: false, size: 0.75 },
  grass: { label: 'Grass', group: 'plants', effect: 'none', rotatable: false, size: 0.65 },
  dunes: { label: 'Dunes', group: 'plants', effect: 'none', rotatable: false, size: 1.7 },
  reeds: { label: 'Reeds', group: 'plants', effect: 'none', rotatable: false, size: 0.85 },
};

export const isTerrain = (k: IconKind): k is TerrainKind => KINDS[k].group === 'terrain';
/** Passes, valleys, canyons and cliffs: marks cut into the land, drawn over the hills and mountains around them. */
export const isCut = (k: IconKind) => KINDS[k].effect === 'lower' || KINDS[k].effect === 'step';

/** Smooth fall-off: 1 at the center, 0 at t = 1. */
const fall = (t: number) => (t >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t)));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Where an icon's effect on the ground is centered: a little above its ground point, under the middle of the drawing. */
function effectCenter(icon: PlacedIcon) {
  const info = KINDS[icon.kind];
  return info.rotatable || info.effect === 'lower' ? { x: icon.x, y: icon.y } : { x: icon.x, y: icon.y - icon.size * 0.22 };
}

/** How far an icon's effect reaches, in map units. */
export function effectRadius(icon: PlacedIcon) {
  const info = KINDS[icon.kind];
  if (info.effect === 'none') return 0;
  if (info.rotatable) return icon.size * 0.6;
  if (info.effect === 'flat') return icon.size * 0.8;
  if (icon.kind === 'pass') return icon.size * 0.6;
  return icon.size * 0.75;
}

/**
 * The final elevation of every cell: the painted base, then valleys, canyons and passes
 * cut in, cliffs stepped, and hills, mountains, volcanoes and plateaus raised last, so
 * the ground under them reads at least their height. Water cells read 0.
 */
export function computeHeights(g: Graph, land: Uint8Array, base: Int16Array, icons: PlacedIcon[]): Int16Array {
  const h = new Float32Array(g.cellCount);
  for (let c = 0; c < g.cellCount; c++) h[c] = land[c] ? base[c] : 0;
  const order: Effect[] = ['lower', 'step', 'raise', 'flat'];
  for (const effect of order)
    for (const icon of icons) {
      const info = KINDS[icon.kind];
      if (info.effect !== effect) continue;
      const meters = icon.meters ?? info.meters?.value ?? 0;
      const center = effectCenter(icon);
      const R = effectRadius(icon);
      const a = ((icon.angle ?? 0) * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      cellsNear(g, center.x, center.y, R, (c) => {
        if (!land[c]) return;
        const dx = g.centers[c * 2] - center.x;
        const dy = g.centers[c * 2 + 1] - center.y;
        if (effect === 'raise') h[c] = Math.max(h[c], meters * fall(Math.hypot(dx, dy) / R));
        else if (effect === 'flat') {
          const d = Math.hypot(dx, dy);
          h[c] = Math.max(h[c], meters * (1 - smoothstep(R * 0.6, R, d)));
        } else if (effect === 'lower') {
          let t: number;
          if (info.rotatable) {
            // Along the icon's direction (u) and across it (v).
            const u = dx * ca + dy * sa;
            const v = -dx * sa + dy * ca;
            const across = icon.kind === 'canyon' ? 0.13 : 0.32;
            t = Math.hypot(u / (icon.size * 0.5), v / (icon.size * across));
          } else t = Math.hypot(dx, dy) / R;
          h[c] = Math.max(0, h[c] - meters * fall(t));
        } else {
          // Cliff: the ground on one side of the line is higher by the drop.
          const u = dx * ca + dy * sa;
          const v = -dx * sa + dy * ca;
          const along = 1 - smoothstep(icon.size * 0.4, icon.size * 0.5, Math.abs(u));
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

/** An icon the app placed by itself because the ground is high. */
export interface AutoTerrain {
  x: number;
  y: number;
  size: number;
  kind: 'hill' | 'mountain';
  variant: number;
}

/**
 * Hills and mountains drawn wherever the ground is high enough, one per cell, sized by
 * height. Not under terrain icons placed by hand: a hill, mountain, volcano or plateau
 * stands alone, and a pass, valley, canyon or cliff clears the hills and mountains along
 * it. Also returns which cells hold terrain, so plants (biome icons) are not drawn there.
 */
export function autoTerrain(g: Graph, land: Uint8Array, heights: Int16Array, icons: PlacedIcon[], seed: number): { icons: AutoTerrain[]; noPlants: Uint8Array } {
  const covered = new Uint8Array(g.cellCount);
  for (const icon of icons) {
    const info = KINDS[icon.kind];
    if (info.effect === 'none') continue;
    const c = effectCenter(icon);
    if (info.effect === 'raise' || info.effect === 'flat') {
      cellsNear(g, c.x, c.y, effectRadius(icon) * (info.effect === 'flat' ? 0.9 : 0.7), (cell) => (covered[cell] = 1));
      continue;
    }
    if (!info.rotatable) {
      // A pass: a gap in the range around it.
      cellsNear(g, c.x, c.y, icon.size * 0.9, (cell) => (covered[cell] = 1));
      continue;
    }
    // Along the icon's direction (u) and across it (v): the ground its drawing covers.
    const a = ((icon.angle ?? 0) * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const across = icon.kind === 'valley' ? 0.32 : icon.kind === 'canyon' ? 0.16 : 0.15;
    cellsNear(g, c.x, c.y, icon.size * 0.55, (cell) => {
      const dx = g.centers[cell * 2] - c.x;
      const dy = g.centers[cell * 2 + 1] - c.y;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (Math.hypot(u / (icon.size * 0.55), v / (icon.size * across + g.spacing * 0.5)) < 1) covered[cell] = 1;
    });
  }
  const out: AutoTerrain[] = [];
  const noPlants = covered.slice();
  for (let c = 0; c < g.cellCount; c++) {
    if (!land[c]) continue;
    const h = heights[c];
    if (h < HILL_FROM) continue;
    noPlants[c] = 1;
    if (covered[c]) continue;
    const rand = seededRandom(mixSeed(seed ^ 0x2c1b3c6d, c));
    const jx = (rand() - 0.5) * 0.4 * g.spacing;
    const jy = (rand() - 0.5) * 0.4 * g.spacing;
    const variant = Math.floor(rand() * 3);
    if (h >= MOUNTAIN_FROM) out.push({ x: g.centers[c * 2] + jx, y: g.centers[c * 2 + 1] + jy + g.spacing * 0.35, size: g.spacing * MOUNTAIN_WIDTH * (1 + 0.2 * Math.min(1, (h - MOUNTAIN_FROM) / 3500)), kind: 'mountain', variant });
    else out.push({ x: g.centers[c * 2] + jx, y: g.centers[c * 2 + 1] + jy + g.spacing * 0.25, size: g.spacing * HILL_WIDTH * (0.9 + 0.1 * ((h - HILL_FROM) / (MOUNTAIN_FROM - HILL_FROM))), kind: 'hill', variant });
  }
  return { icons: out, noPlants };
}
