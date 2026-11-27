import { mixSeed, seededRandom } from '../rng';
import type { CliffShape, IconKind } from '../world/types';
import { CLIFF_RIM, cliffAway, cliffFacing } from './art/cliff';
import { setMinLine, type ArtColors } from './art/ink';
import { cactus, deciduous, dunes, grass, palm, pine, reeds, shrub } from './art/plants';
import { hill, mountain, plateau, volcano } from './art/terrain';
import type { SlotLook } from './biomes';
import type { Graph } from './graph';
import { KINDS, cliffTurn } from './terrain';

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

/** Icons with a direction (cliffs) turn around their point. */
export const ROTATABLE = new Set<IconKind>(['cliff']);

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
  cliff: { aspect: 0.667, anchorY: CLIFF_RIM.facing, variants: 8, minPx: 10, perCell: 0 },
  deciduous: { aspect: 1.15, anchorY: 0.96, variants: 12, minPx: 4, perCell: 4 },
  pine: { aspect: 1.5, anchorY: 0.97, variants: 10, minPx: 4, perCell: 4 },
  jungle: { aspect: 1.15, anchorY: 0.97, variants: 10, minPx: 5, perCell: 3 },
  cactus: { aspect: 1.3, anchorY: 0.96, variants: 8, minPx: 5, perCell: 1 },
  shrub: { aspect: 0.7, anchorY: 0.95, variants: 8, minPx: 7, perCell: 2 },
  grass: { aspect: 0.6, anchorY: 0.95, variants: 8, minPx: 8, perCell: 1.5 },
  dunes: { aspect: 0.45, anchorY: 0.95, variants: 8, minPx: 9, perCell: 0.5 },
  reeds: { aspect: 1, anchorY: 0.86, variants: 8, minPx: 8, perCell: 2 },
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

/** A cliff's drawing: whether its drop faces away from the viewer (so its face is hidden), and its shape. */
export interface CliffLook {
  away?: boolean;
  shape?: CliffShape;
}

function kindSeed(kind: IconKind) {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  return h >>> 0;
}

function drawArt(ctx: CanvasRenderingContext2D, kind: IconKind, variant: number, W: number, H: number, c: ArtColors, look: CliffLook) {
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
      return (look.away ? cliffAway : cliffFacing)(ctx, seed, W, H, c, look.shape ?? 'even');
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

function makeSprite(kind: IconKind, variant: number, style: IconStyle, level: number, look: CliffLook): Sprite {
  const spec = ART[kind];
  const W = UNITS;
  const H = UNITS * spec.aspect;
  const pad = 0.16 * Math.max(W, H);
  const k = level / UNITS;
  const cw = Math.max(1, Math.ceil((W + 2 * pad) * k));
  const ch = Math.max(1, Math.ceil((H + 2 * pad) * k));
  const anchorY = kind === 'cliff' ? (look.away ? CLIFF_RIM.away : CLIFF_RIM.facing) : spec.anchorY;
  const make = (colors: ArtColors | 'paint') => {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(k, 0, 0, k, pad * k, pad * k);
    let c = colors === 'paint' ? colorsFor(kind, style) : colors;
    if (colors === 'paint' && style === 'painterly' && KINDS[kind].group === 'terrain' && typeof c.fill === 'string') {
      // Painterly terrain: the fill fades out over the lowest part, toward the ground (for a cliff, toward the foot of its face).
      const y1 = kind === 'cliff' ? H * (look.away ? 0.78 : 0.95) : H * anchorY;
      const y0 = kind === 'cliff' ? H * (look.away ? 0.6 : 0.5) : H * (anchorY - 0.3);
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, c.fill);
      g.addColorStop(1, rgba(c.fill, 0));
      c = { ...c, fill: g };
    }
    // The thinnest line: about 0.6 pixels at this size.
    setMinLine(0.6 / k);
    drawArt(ctx, kind, variant, W, H, c, look);
    return canvas;
  };
  return { canvas: make('paint'), mask: make(MASK_COLORS), ax: (pad + W * 0.5) * k, ay: (pad + H * anchorY) * k, w: level };
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
export function iconSprite(kind: IconKind, variant: number, style: IconStyle, px: number, look: CliffLook = {}, now = false): Sprite | null {
  const level = LEVELS.find((l) => l >= px) ?? LEVELS[LEVELS.length - 1];
  const base = `${style}|${kind}|${variant}|${look.away ? 1 : 0}|${look.shape ?? ''}`;
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
  /** Cliffs: the compass direction the drop faces. */
  angle?: number;
  shape?: CliffShape;
  /** Set for icons placed by hand: the placed icon's ID. */
  placed?: string;
  /** Set for icons the app drew by itself: the key that names it (see MapInfo.hiddenAuto). */
  auto?: string;
}

/** How a placement is drawn: turned by `turn` degrees, and for a cliff which drawing and shape. */
export function placementLook(p: { set: IconKind; angle?: number; shape?: CliffShape }): { turn: number; look: CliffLook } {
  if (p.set !== 'cliff') return { turn: 0, look: {} };
  const turn = cliffTurn(p);
  // A drop facing up the map shows the drawing with the face hidden, turned the other way
  // round, so its left and right ends swap.
  const away = Math.cos((turn * Math.PI) / 180) < -1e-9;
  if (!away) return { turn, look: { shape: p.shape ?? 'even' } };
  const shape: CliffShape = p.shape === 'taper-left' ? 'taper-right' : p.shape === 'taper-right' ? 'taper-left' : (p.shape ?? 'even');
  return { turn: turn - 180, look: { away: true, shape } };
}

/** The box around an icon's drawing (unturned), relative to its ground point, in map units. */
export function iconBox(p: { set: IconKind; size: number }, away = false) {
  const spec = ART[p.set];
  const H = p.size * spec.aspect;
  const anchorY = p.set === 'cliff' ? (away ? CLIFF_RIM.away : CLIFF_RIM.facing) : spec.anchorY;
  return { left: -p.size / 2, top: -H * anchorY, width: p.size, height: H };
}

/** Whether map point (x, y) is on the icon (inside the middle of its drawing). */
export function iconHit(p: Placement, x: number, y: number) {
  const { turn, look } = placementLook(p);
  let dx = x - p.x;
  let dy = y - p.y;
  if (turn) {
    const a = (-turn * Math.PI) / 180;
    [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }
  const b = iconBox(p, look.away);
  return Math.abs(dx) <= b.width * 0.4 && dy >= b.top + b.height * 0.1 && dy <= b.top + b.height * 1.02;
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
