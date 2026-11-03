import type { Realm } from '../world/types';
import { LAND_MIN, OCEAN_MAX, clampElevation, isLand, type MapLayers, type Rect } from './grid';

// The painting tools. They change the grids in place, tell the renderer which cells
// changed after every dab, and keep an undo history of whole strokes.

export type PaintMode = 'land' | 'biome' | 'elevation';
export type ElevationOp = 'set' | 'raise' | 'lower' | 'smooth';

export interface Brush {
  mode: PaintMode;
  /** Brush radius in cells. */
  radius: number;
  /** Land mode: paint land or ocean. */
  land: 'land' | 'ocean';
  /** Biome mode: the slot to paint (0 erases the biome), and whether it is a land or ocean biome. */
  biomeSlot: number;
  biomeRealm: Realm | null;
  /** Elevation mode. */
  elevationOp: ElevationOp;
  /** Meters, for Set. */
  elevationValue: number;
  /** Meters added or taken away at the brush center per dab, for Raise and Lower. */
  elevationStep: number;
}

interface Step {
  rect: Rect;
  before: { elevation: Int16Array; biome: Uint8Array };
  after: { elevation: Int16Array; biome: Uint8Array };
}

const MAX_STEPS = 100;
/** Soft edge: 1 at the center, 0 at the rim. */
const falloff = (t: number) => 0.5 * (1 + Math.cos(Math.PI * Math.min(1, t)));

function copyRect(l: MapLayers, r: Rect, elevation = l.elevation, biome = l.biome) {
  const w = r.x1 - r.x0;
  const e = new Int16Array(w * (r.y1 - r.y0));
  const b = new Uint8Array(w * (r.y1 - r.y0));
  for (let y = r.y0; y < r.y1; y++) {
    e.set(elevation.subarray(y * l.width + r.x0, y * l.width + r.x1), (y - r.y0) * w);
    b.set(biome.subarray(y * l.width + r.x0, y * l.width + r.x1), (y - r.y0) * w);
  }
  return { elevation: e, biome: b };
}

function writeRect(l: MapLayers, r: Rect, data: { elevation: Int16Array; biome: Uint8Array }) {
  const w = r.x1 - r.x0;
  for (let y = r.y0; y < r.y1; y++) {
    l.elevation.set(data.elevation.subarray((y - r.y0) * w, (y - r.y0 + 1) * w), y * l.width + r.x0);
    l.biome.set(data.biome.subarray((y - r.y0) * w, (y - r.y0 + 1) * w), y * l.width + r.x0);
  }
}

const union = (a: Rect | null, b: Rect): Rect => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b });

/** Sets a cell's elevation. A cell that crosses sea level loses its biome, which belonged to the other side. */
function setElevation(l: MapLayers, i: number, v: number) {
  const before = l.elevation[i];
  const next = clampElevation(v);
  if (isLand(before) !== isLand(next)) l.biome[i] = 0;
  l.elevation[i] = next;
}

export class Painter {
  private stroke: { elevation: Int16Array; biome: Uint8Array } | null = null;
  private changed: Rect | null = null;
  private last: { x: number; y: number } | null = null;
  private undos: Step[] = [];
  private redos: Step[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private layers: () => MapLayers | null,
    private onChange: (r: Rect) => void,
    private onEdited: () => void,
  ) {}

  get canUndo() {
    return this.undos.length > 0;
  }
  get canRedo() {
    return this.redos.length > 0;
  }
  /** Calls `fn` when undo or redo becomes available or unavailable. */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private notify() {
    for (const fn of this.listeners) fn();
  }

  clearHistory() {
    this.undos = [];
    this.redos = [];
    this.notify();
  }

  /** Starts a stroke at cell coordinates (x, y), which can be fractions. */
  begin(brush: Brush, x: number, y: number) {
    const l = this.layers();
    if (!l) return;
    this.stroke = { elevation: l.elevation.slice(), biome: l.biome.slice() };
    this.changed = null;
    this.last = { x, y };
    this.dab(brush, x, y);
  }

  /** Continues the stroke, with dabs close enough together to leave no gaps. */
  move(brush: Brush, x: number, y: number) {
    if (!this.stroke || !this.last) return;
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(0.5, brush.radius * 0.35);
    if (dist < spacing) return;
    const n = Math.floor(dist / spacing);
    for (let k = 1; k <= n; k++) this.dab(brush, this.last.x + (dx * k) / n, this.last.y + (dy * k) / n);
    this.last = { x, y };
  }

  end() {
    const l = this.layers();
    if (l && this.stroke && this.changed) this.record(l, this.changed, this.stroke);
    this.stroke = null;
    this.changed = null;
    this.last = null;
  }

  private record(l: MapLayers, rect: Rect, original: { elevation: Int16Array; biome: Uint8Array }) {
    this.undos.push({ rect, before: copyRect(l, rect, original.elevation, original.biome), after: copyRect(l, rect) });
    if (this.undos.length > MAX_STEPS) this.undos.shift();
    this.redos = [];
    this.onEdited();
    this.notify();
  }

  private dab(brush: Brush, cx: number, cy: number) {
    const l = this.layers();
    if (!l) return;
    const r = Math.max(0.5, brush.radius);
    const rect: Rect = {
      x0: Math.max(0, Math.floor(cx - r)),
      y0: Math.max(0, Math.floor(cy - r)),
      x1: Math.min(l.width, Math.ceil(cx + r)),
      y1: Math.min(l.height, Math.ceil(cy + r)),
    };
    if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return;
    // Smoothing reads from a copy, so cells already smoothed in this dab do not count twice.
    const src = brush.mode === 'elevation' && brush.elevationOp === 'smooth' ? l.elevation.slice() : null;
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        const i = y * l.width + x;
        const e = l.elevation[i];
        if (brush.mode === 'land') {
          if (brush.land === 'land') setElevation(l, i, Math.max(e, LAND_MIN));
          else setElevation(l, i, Math.min(e, OCEAN_MAX));
        } else if (brush.mode === 'biome') {
          if (brush.biomeSlot === 0) l.biome[i] = 0;
          else if (brush.biomeRealm && (brush.biomeRealm === 'land') === isLand(e)) l.biome[i] = brush.biomeSlot;
        } else {
          const t = falloff(d / r);
          if (brush.elevationOp === 'set') setElevation(l, i, brush.elevationValue);
          else if (brush.elevationOp === 'raise') setElevation(l, i, e + brush.elevationStep * t);
          else if (brush.elevationOp === 'lower') setElevation(l, i, e - brush.elevationStep * t);
          else if (src) {
            let sum = 0;
            let n = 0;
            for (let oy = -1; oy <= 1; oy++)
              for (let ox = -1; ox <= 1; ox++) {
                const nx = x + ox;
                const ny = y + oy;
                if (nx < 0 || ny < 0 || nx >= l.width || ny >= l.height) continue;
                sum += src[ny * l.width + nx];
                n++;
              }
            setElevation(l, i, e + (sum / n - e) * 0.6 * t);
          }
        }
      }
    }
    this.changed = union(this.changed, rect);
    this.onChange(rect);
  }

  /**
   * Fills the connected area around a cell (4-neighbors): in Land mode, the land or the
   * ocean it belongs to; in Biome mode, the cells on the same side of the coast with the
   * same biome. Elevation has no fill.
   */
  fill(brush: Brush, x: number, y: number) {
    const l = this.layers();
    if (!l || brush.mode === 'elevation') return;
    const sx = Math.floor(x);
    const sy = Math.floor(y);
    if (sx < 0 || sy < 0 || sx >= l.width || sy >= l.height) return;
    const seed = sy * l.width + sx;
    const seedLand = isLand(l.elevation[seed]);
    const seedBiome = l.biome[seed];
    if (brush.mode === 'biome') {
      if (brush.biomeSlot !== 0 && (!brush.biomeRealm || (brush.biomeRealm === 'land') !== seedLand)) return;
      if (seedBiome === brush.biomeSlot) return;
    } else if ((brush.land === 'land') === seedLand) return;

    const original = { elevation: l.elevation.slice(), biome: l.biome.slice() };
    const same = (i: number) => isLand(original.elevation[i]) === seedLand && (brush.mode === 'land' || original.biome[i] === seedBiome);
    const seen = new Uint8Array(l.width * l.height);
    const queue = new Int32Array(l.width * l.height);
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    const rect: Rect = { x0: sx, y0: sy, x1: sx + 1, y1: sy + 1 };
    while (head < tail) {
      const i = queue[head++];
      const cx = i % l.width;
      const cy = (i - cx) / l.width;
      if (brush.mode === 'land') setElevation(l, i, brush.land === 'land' ? Math.max(original.elevation[i], LAND_MIN) : Math.min(original.elevation[i], OCEAN_MAX));
      else l.biome[i] = brush.biomeSlot;
      if (cx < rect.x0) rect.x0 = cx;
      if (cx >= rect.x1) rect.x1 = cx + 1;
      if (cy < rect.y0) rect.y0 = cy;
      if (cy >= rect.y1) rect.y1 = cy + 1;
      const push = (j: number) => {
        if (!seen[j] && same(j)) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      };
      if (cx > 0) push(i - 1);
      if (cx < l.width - 1) push(i + 1);
      if (cy > 0) push(i - l.width);
      if (cy < l.height - 1) push(i + l.width);
    }
    this.onChange(rect);
    this.record(l, rect, original);
  }

  undo() {
    const l = this.layers();
    const s = this.undos.pop();
    if (!l || !s) return;
    writeRect(l, s.rect, s.before);
    this.redos.push(s);
    this.onChange(s.rect);
    this.onEdited();
    this.notify();
  }

  redo() {
    const l = this.layers();
    const s = this.redos.pop();
    if (!l || !s) return;
    writeRect(l, s.rect, s.after);
    this.undos.push(s);
    this.onChange(s.rect);
    this.onEdited();
    this.notify();
  }
}

/** What is under the cursor, for the readout and the eyedropper. */
export function cellAt(l: MapLayers, x: number, y: number) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= l.width || cy >= l.height) return null;
  const i = cy * l.width + cx;
  return { x: cx, y: cy, elevation: l.elevation[i], biomeSlot: l.biome[i] };
}
