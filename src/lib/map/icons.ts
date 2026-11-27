import { mixSeed, seededRandom } from '../rng';
import type { CliffShape, IconKind } from '../world/types';
import { CLIFF_RIM, LEAN, SHEAR, cliff, cliffFrame, type Dir, type Frame } from './art/cliff';
import { setMinLine, type ArtColors } from './art/ink';
import { cactus, deciduous, dunes, grass, palm, pine, reeds, shrub } from './art/plants';
import { hill, mountain, plateau, volcano } from './art/terrain';
import { waterfall, waterfallFrame } from './art/water';
import type { SlotLook } from './biomes';
import type { Graph } from './graph';
import { KINDS, dirOf } from './terrain';

// Map icons, drawn in code (lib/map/art) in two styles: ink for the atlas, color for the
// painterly map. Each kind has a set of different drawings (variants). A drawing is made at a
// few fixed widths (8, 16, 32 ... 1024 pixels), and stamped at the closest one, scaled, so
// icons stay sharp at every zoom. A drawing is always made in the same units and scaled, so
// it looks the same at every width.
//
// An icon hides what is behind it: each drawing comes with a mask of its shape, which erases
// the icons behind it before it is stamped. On the atlas the land then shows through its
// inside, as on Caleb's Nortantis map; on the painterly map terrain is filled with color that
// fades out toward the ground, so it does not stop at a hard line.

export type IconStyle = 'atlas' | 'painterly';

interface ArtSpec {
  /** The drawing's height over its width. */
  aspect: number;
  /** Where the ground point is, as a fraction of the drawing's height (it is always in the middle across). */
  anchorY: number;
  /** How many different drawings. */
  variants: number;
  /** The smallest width on screen (CSS pixels) worth drawing; smaller ones are left out. */
  minPx: number;
  /** For a biome's icons: how many per land cell. */
  perCell: number;
}

const ART: Record<IconKind, ArtSpec> = {
  mountain: { aspect: 0.75, anchorY: 0.97, variants: 16, minPx: 8, perCell: 0 },
  hill: { aspect: 0.6, anchorY: 0.95, variants: 12, minPx: 6, perCell: 0 },
  volcano: { aspect: 1, anchorY: 0.97, variants: 8, minPx: 8, perCell: 0 },
  plateau: { aspect: 0.55, anchorY: 0.95, variants: 8, minPx: 8, perCell: 0 },
  // Cliffs and waterfalls: as drawn facing south; each direction has its own box (frameOf).
  cliff: { aspect: 0.667, anchorY: CLIFF_RIM.facing, variants: 8, minPx: 10, perCell: 0 },
  deciduous: { aspect: 1.15, anchorY: 0.96, variants: 12, minPx: 4, perCell: 4 },
  pine: { aspect: 1.5, anchorY: 0.97, variants: 10, minPx: 4, perCell: 4 },
  jungle: { aspect: 1.15, anchorY: 0.97, variants: 10, minPx: 5, perCell: 3 },
  cactus: { aspect: 1.3, anchorY: 0.96, variants: 8, minPx: 5, perCell: 1 },
  shrub: { aspect: 0.7, anchorY: 0.95, variants: 8, minPx: 7, perCell: 2 },
  grass: { aspect: 0.6, anchorY: 0.95, variants: 8, minPx: 8, perCell: 1.5 },
  dunes: { aspect: 0.45, anchorY: 0.95, variants: 8, minPx: 9, perCell: 0.5 },
  reeds: { aspect: 1, anchorY: 0.86, variants: 8, minPx: 8, perCell: 2 },
  waterfall: { aspect: 1.1, anchorY: 0.2, variants: 8, minPx: 8, perCell: 0 },
};
/** Of the mountain drawings, the last few are spires (narrow needle peaks). */
const SPIRES_FROM = 13;

export const variantsOf = (kind: IconKind) => ART[kind].variants;
export const aspectOf = (kind: IconKind) => ART[kind].aspect;
export const minPixels = (kind: IconKind) => ART[kind].minPx;

const INK = '#2a241c';
const ATLAS_COLORS: ArtColors = { fill: null, color: INK, wash: 'rgba(38, 34, 28, 0.2)', washDark: 'rgba(38, 34, 28, 0.38)' };
const MASK_COLORS: ArtColors = { fill: '#000', color: '#000', wash: '#000', washDark: '#000' };

/** Painterly colors per icon: fill and outline. */
const PAINT: Record<IconKind, [string, string]> = {
  mountain: ['#c2ab88', '#4a3b2c'],
  hill: ['#a99d6b', '#5a5032'],
  volcano: ['#a08a72', '#3e3026'],
  plateau: ['#cfae78', '#6b5233'],
  cliff: ['#a8987a', '#3e3426'],
  deciduous: ['#5b8c45', '#2c4a25'],
  pine: ['#3a6a4d', '#1c3528'],
  jungle: ['#3f8a4c', '#1a4224'],
  cactus: ['#78a35c', '#3d5a2e'],
  shrub: ['#7a9a52', '#3f5230'],
  grass: ['#7a9a4a', '#4a6332'],
  dunes: ['#d8b874', '#8a6c38'],
  reeds: ['#6c8c52', '#33472a'],
  waterfall: ['#a8987a', '#3e3426'],
};

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function colorsFor(kind: IconKind, style: IconStyle): ArtColors {
  if (style === 'atlas') return ATLAS_COLORS;
  const [fill, line] = PAINT[kind];
  return { fill, color: line, wash: rgba(line, 0.28), washDark: rgba(line, 0.48) };
}

/** Which drawing of an icon: for a cliff or a waterfall, the direction it faces (a drawing each); for a cliff, its shape. */
export interface IconLook {
  dir?: Dir;
  shape?: CliffShape;
}

/** The box of an icon's drawing, in units of its width, with its point at (ax, ay). */
export function frameOf(kind: IconKind, look: IconLook = {}): Frame {
  if (kind === 'cliff') return cliffFrame(look.dir ?? 4);
  if (kind === 'waterfall') return waterfallFrame(look.dir ?? 4);
  const spec = ART[kind];
  return { w: 1, h: spec.aspect, ax: 0.5, ay: spec.aspect * spec.anchorY };
}

/**
 * On the painterly map a cliff's or waterfall's fill fades out toward the foot of its face (on
 * a drop facing away, across the high ground on the near side). The fade runs across the rim:
 * `n` is the rim's normal on that side, `v` the way down the face (strokes lean on SE and SW,
 * run out on E and W), and the fade lies from d0 to d1 widths down the face.
 */
function faceFade(kind: 'cliff' | 'waterfall', dir: Dir) {
  const a = (dir * Math.PI) / 4;
  const d: [number, number] = [Math.sin(a), -Math.cos(a)];
  const away = dir === 0 || dir === 1 || dir === 7;
  const n: [number, number] = away ? [-d[0], -d[1]] : d;
  const v: [number, number] = dir === 2 || dir === 6 ? [Math.sign(d[0]) * SHEAR, 1] : dir === 3 || dir === 5 ? [Math.sign(d[0]) * LEAN, 1] : [0, 1];
  const along = v[0] * n[0] + v[1] * n[1];
  const [d0, d1] = away ? (kind === 'cliff' ? [0.013, 0.133] : [0.01, 0.13]) : kind === 'cliff' ? [0.173, 0.473] : [0.22, 0.715];
  return { n, d0: d0 * along, d1: d1 * along };
}

function kindSeed(kind: IconKind) {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  return h >>> 0;
}

function drawArt(ctx: CanvasRenderingContext2D, kind: IconKind, variant: number, W: number, H: number, c: ArtColors, look: IconLook) {
  const seed = mixSeed(kindSeed(kind), variant);
  switch (kind) {
    case 'mountain':
      return mountain(ctx, seed, W, H, c, variant >= SPIRES_FROM);
    case 'hill':
      return hill(ctx, seed, W, H, c);
    case 'volcano':
      return volcano(ctx, seed, W, H, c);
    case 'plateau':
      return plateau(ctx, seed, W, H, c);
    case 'cliff':
      return cliff(ctx, seed, UNITS, c, look.shape ?? 'even', look.dir ?? 4);
    case 'deciduous':
      return deciduous(ctx, seed, W, H, c);
    case 'pine':
      return pine(ctx, seed, W, H, c);
    case 'jungle':
      return palm(ctx, seed, W, H, c);
    case 'cactus':
      return cactus(ctx, seed, W, H, c);
    case 'shrub':
      return shrub(ctx, seed, W, H, c);
    case 'grass':
      return grass(ctx, seed, W, H, c);
    case 'dunes':
      return dunes(ctx, seed, W, H, c);
    case 'reeds':
      return reeds(ctx, seed, W, H, c, c === MASK_COLORS ? '#000' : c.fill === null ? 'rgba(38, 34, 28, 0.22)' : 'rgba(70, 110, 140, 0.5)');
    case 'waterfall':
      // The falling water is opaque, so it hides the river line under it: pale on the atlas, light blue on the painterly map.
      // The river's last stretch before a lip facing away is left see-through, so the map's river shows there.
      return waterfall(ctx, seed, UNITS, c, c === MASK_COLORS ? '#000' : c.fill === null ? '#e3d3b4' : '#d4e7f1', look.dir ?? 4, c === MASK_COLORS ? '#000' : null);
  }
}

// ------------------------------------------------------------------ sprites

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** The shape's mask: erases what is behind the icon. */
  mask: HTMLCanvasElement | null;
  /** Where the ground point is in the sprite, in its pixels. */
  ax: number;
  ay: number;
  /** The drawing's width in the sprite's pixels. */
  w: number;
}

/** Drawings are made in these units (the drawing's width) and scaled to the size wanted. */
const UNITS = 400;
const LEVELS = [8, 16, 32, 64, 128, 256, 512, 1024];
/** How many sprite pixels to keep, all sprites together (about 100 MB). */
const BUDGET = 24e6;

const cache = new Map<string, Sprite>();
let cachedPixels = 0;
const pending = new Map<string, () => void>();
let frameEnds = 0;
let onReady: (() => void) | null = null;

/** Called once sprites asked for while drawing (and made later, so drawing stays quick) are ready: draw again. */
export function onSpritesReady(fn: (() => void) | null) {
  onReady = fn;
}

/** Starts drawing a frame: new sprites may be made during the next `ms` milliseconds; after that they are made in the background. */
export function beginIconFrame(ms = 40) {
  frameEnds = performance.now() + ms;
}

function makeSprite(kind: IconKind, variant: number, style: IconStyle, level: number, look: IconLook): Sprite {
  const f = frameOf(kind, look);
  const W = UNITS * f.w;
  const H = UNITS * f.h;
  const pad = 0.16 * UNITS * Math.max(1, f.h);
  const k = level / UNITS;
  const cw = Math.max(1, Math.ceil((W + 2 * pad) * k));
  const ch = Math.max(1, Math.ceil((H + 2 * pad) * k));
  const make = (colors: ArtColors | 'paint') => {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, pad * k, pad * k);
    let c = colors === 'paint' ? colorsFor(kind, style) : colors;
    if (colors === 'paint' && style === 'painterly' && (KINDS[kind].group === 'terrain' || kind === 'waterfall') && typeof c.fill === 'string') {
      // Painterly terrain: the fill fades out over the lowest part, toward the ground (for a cliff, toward the foot of its
      // face; for a waterfall, toward the pool).
      let g: CanvasGradient;
      if (kind === 'cliff' || kind === 'waterfall') {
        const { n, d0, d1 } = faceFade(kind, look.dir ?? 4);
        const ax = UNITS * f.ax;
        const ay = UNITS * f.ay;
        g = ctx.createLinearGradient(ax + n[0] * d0 * UNITS, ay + n[1] * d0 * UNITS, ax + n[0] * d1 * UNITS, ay + n[1] * d1 * UNITS);
      } else g = ctx.createLinearGradient(0, H * (ART[kind].anchorY - 0.3), 0, H * ART[kind].anchorY);
      g.addColorStop(0, c.fill);
      g.addColorStop(1, rgba(c.fill, 0));
      c = { ...c, fill: g };
    }
    // The thinnest line: about 0.6 pixels at this size.
    setMinLine(0.6 / k);
    drawArt(ctx, kind, variant, W, H, c, look);
    return canvas;
  };
  return { canvas: make('paint'), mask: make(MASK_COLORS), ax: (pad + UNITS * f.ax) * k, ay: (pad + UNITS * f.ay) * k, w: level };
}

const pixelsOf = (s: Sprite) => s.canvas.width * s.canvas.height * (s.mask ? 2 : 1);

function store(key: string, s: Sprite) {
  cache.set(key, s);
  cachedPixels += pixelsOf(s);
  // Forget the sprites used least recently once over budget.
  for (const [k, old] of cache) {
    if (cachedPixels <= BUDGET) break;
    if (k === key) continue;
    cache.delete(k);
    cachedPixels -= pixelsOf(old);
  }
}

function runPending() {
  const until = performance.now() + 25;
  for (const [key, make] of pending) {
    pending.delete(key);
    make();
    if (performance.now() > until) break;
  }
  if (pending.size) window.setTimeout(runPending, 0);
  else onReady?.();
}

/**
 * The sprite for an icon `px` pixels wide. While drawing a frame, sprites not made yet are
 * made at once until the frame's time is used up; after that a sprite of another size (or
 * nothing) stands in, and the right one is made in the background. `now` always makes it.
 */
export function iconSprite(kind: IconKind, variant: number, style: IconStyle, px: number, look: IconLook = {}, now = false): Sprite | null {
  const level = LEVELS.find((l) => l >= px) ?? LEVELS[LEVELS.length - 1];
  const base = `${style}|${kind}|${variant}|${look.dir ?? ''}|${look.shape ?? ''}`;
  const key = `${base}|${level}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (now || performance.now() < frameEnds) {
    const s = makeSprite(kind, variant, style, level, look);
    store(key, s);
    return s;
  }
  if (!pending.has(key)) {
    if (!pending.size) window.setTimeout(runPending, 0);
    pending.set(key, () => {
      if (!cache.has(key)) store(key, makeSprite(kind, variant, style, level, look));
    });
  }
  // Meanwhile: the nearest size already made, larger ones first.
  const i = LEVELS.indexOf(level);
  for (let d = 1; d < LEVELS.length; d++)
    for (const j of [i + d, i - d]) {
      const s = j >= 0 && j < LEVELS.length ? cache.get(`${base}|${LEVELS[j]}`) : undefined;
      if (s) return s;
    }
  return null;
}

// ------------------------------------------------------------------ placements

export interface Placement {
  /** Ground point, in map units (for a cliff, the middle of its rim). */
  x: number;
  y: number;
  /** Width in map units. */
  size: number;
  set: IconKind;
  variant: number;
  /** Cliffs and waterfalls: the compass direction the drop faces (drawn as the nearest of 8). */
  angle?: number;
  shape?: CliffShape;
  /** Set for icons placed by hand: the placed icon's ID. */
  placed?: string;
  /** Set for icons the app drew by itself: the key that names it (see MapInfo.hiddenAuto). */
  auto?: string;
}

/** Which drawing a placement uses: for a cliff or a waterfall its direction (and a cliff's shape). */
export function placementLook(p: { set: IconKind; angle?: number; shape?: CliffShape }): IconLook {
  if (p.set === 'waterfall') return { dir: dirOf(p) };
  if (p.set !== 'cliff') return {};
  const dir = dirOf(p);
  // Left and right are as seen with the drop facing you: on a drop facing away they are the
  // other way round on the page.
  const away = dir === 0 || dir === 1 || dir === 7;
  const shape: CliffShape = away && p.shape === 'taper-left' ? 'taper-right' : away && p.shape === 'taper-right' ? 'taper-left' : (p.shape ?? 'even');
  return { dir, shape };
}

/** The box around an icon's drawing, relative to its ground point, in map units. */
export function iconBox(p: { set: IconKind; size: number }, look: IconLook = {}) {
  const f = frameOf(p.set, look);
  return { left: -p.size * f.ax, top: -p.size * f.ay, width: p.size * f.w, height: p.size * f.h };
}

/** Whether map point (x, y) is on the icon (inside the middle of its drawing). */
export function iconHit(p: Placement, x: number, y: number) {
  const b = iconBox(p, placementLook(p));
  const dx = x - p.x;
  const dy = y - p.y;
  return dx >= b.left + b.width * 0.1 && dx <= b.left + b.width * 0.9 && dy >= b.top + b.height * 0.1 && dy <= b.top + b.height * 1.02;
}

const topDown = new WeakMap<Graph, Int32Array>();
function cellsTopDown(g: Graph) {
  let order = topDown.get(g);
  if (!order) {
    order = Int32Array.from({ length: g.cellCount }, (_, i) => i).sort((a, b) => g.centers[a * 2 + 1] - g.centers[b * 2 + 1]);
    topDown.set(g, order);
  }
  return order;
}

/** The key that names a plant the app draws (see MapInfo.hiddenAuto). */
export const autoPlantKey = (cell: number, k: number) => `p${cell}.${k}`;

/**
 * Where the biome icons go: a few per land cell, jittered around the cell's center, the
 * same every time (seeded by the map's seed and the cell). Cells on the coast get one
 * smaller icon at their center, so icons stay off the water. Icons Caleb took over are left out.
 */
export function placeIcons(g: Graph, land: Uint8Array, biome: Uint8Array, looks: (SlotLook | null)[], seed: number, noPlants: Uint8Array | undefined, hidden: ReadonlySet<string>): Placement[] {
  const out: Placement[] = [];
  // Cells from top to bottom, so the list comes out nearly in drawing order and sorts quickly.
  for (const c of cellsTopDown(g)) {
    if (!land[c] || !biome[c] || noPlants?.[c]) continue;
    const look = looks[biome[c]];
    if (!look || look.icons === 'none') continue;
    const set = look.icons;
    const spec = ART[set];
    const width = KINDS[set].size * g.spacing;
    let coastal = false;
    for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1] && !coastal; k++) {
      const e = g.cellEdges[k];
      const other = g.edges[e * 4 + 2] === c ? g.edges[e * 4 + 3] : g.edges[e * 4 + 2];
      if (other >= 0 && !land[other]) coastal = true;
    }
    const rand = seededRandom(mixSeed(seed ^ 0x5bd1e995, c));
    const cx = g.centers[c * 2];
    const cy = g.centers[c * 2 + 1];
    if (coastal) {
      const variant = Math.floor(rand() * spec.variants);
      if (set === 'dunes' || hidden.has(autoPlantKey(c, 0))) continue;
      out.push({ x: cx, y: cy, size: width * 0.8, set, variant, auto: autoPlantKey(c, 0) });
      continue;
    }
    let n = Math.floor(spec.perCell);
    if (rand() < spec.perCell - n) n++;
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * g.spacing * 0.45;
      const size = width * (0.85 + rand() * 0.3);
      const variant = Math.floor(rand() * spec.variants);
      if (hidden.has(autoPlantKey(c, k))) continue;
      out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size, set, variant, auto: autoPlantKey(c, k) });
    }
  }
  return out;
}
