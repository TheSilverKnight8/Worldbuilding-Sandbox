import { across, cellAt, cellsNear, type Graph } from './graph';
import { DEFAULT_LAND_ELEVATION, ELEVATION_MAX } from './terrain';

// The painting tools: land and water (Stage 2), biomes (Stage 3), elevation (Stage 4).
// They change whole cells, tell the map to redraw after every dab, and keep one undo
// history of whole strokes and fills, covering land, biomes and elevation together. Other
// edits (icons placed by hand) add their own steps to the same history.

export type PaintMode = 'land' | 'biome' | 'elevation';
export type ElevationOp = 'set' | 'raise' | 'lower' | 'smooth';

export interface Brush {
  mode: PaintMode;
  /** Land mode: paint land (true) or water (false). */
  land: boolean;
  /** Biome mode: the biome slot to paint; 0 erases the biome. */
  biomeSlot: number;
  /** Elevation mode. */
  op: ElevationOp;
  /** Meters: the height for Set, the change at the brush's center per dab for Raise and Lower. */
  meters: number;
  /** Brush radius in map units. */
  radius: number;
}

export interface PaintTarget {
  graph: Graph;
  land: Uint8Array;
  biome: Uint8Array;
  elevation: Int16Array;
}

interface CellStep {
  cells: Int32Array;
  before: { land: Uint8Array; biome: Uint8Array; elevation: Int16Array };
  after: { land: Uint8Array; biome: Uint8Array; elevation: Int16Array };
}

/** Any other change that can be undone (e.g. placing an icon). */
export interface CustomStep {
  undo: () => void;
  redo: () => void;
  /**
   * Steps with the same key, pushed less than a second apart with nothing in between, are
   * one step (e.g. dragging a slider or typing a number for the same icon).
   */
  key?: string;
}

type Step = { cells: CellStep } | { custom: CustomStep };
type Before = [number, number, number];

const MAX_STEPS = 100;
/** Soft edge for raising, lowering and smoothing: 1 at the center, 0 at the rim. */
const falloff = (t: number) => 0.5 * (1 + Math.cos(Math.PI * Math.min(1, t)));

export class MapPainter {
  /** Cells changed in the current stroke, with their land, biome and elevation before it. */
  private stroke: Map<number, Before> | null = null;
  private last: { x: number; y: number } | null = null;
  private undos: Step[] = [];
  private redos: Step[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private target: () => PaintTarget | null,
    private onChange: (what: 'land' | 'biome' | 'elevation') => void,
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

  private lastPush: { key: string; at: number } | null = null;

  /** Adds a change made elsewhere (already applied) to the undo history. */
  push(step: CustomStep) {
    const last = this.undos[this.undos.length - 1];
    const now = performance.now();
    if (step.key && last && 'custom' in last && last.custom.key === step.key && this.lastPush?.key === step.key && now - this.lastPush.at < 1000) {
      // Same edit continued: keep the first step's undo, take the new redo.
      last.custom = { ...step, undo: last.custom.undo };
      this.lastPush = { key: step.key, at: now };
      this.redos = [];
      this.notify();
      return;
    }
    this.lastPush = step.key ? { key: step.key, at: now } : null;
    this.undos.push({ custom: step });
    if (this.undos.length > MAX_STEPS) this.undos.shift();
    this.redos = [];
    this.notify();
  }

  private remember(t: PaintTarget, c: number, changed: Map<number, Before>) {
    if (!changed.has(c)) changed.set(c, [t.land[c], t.biome[c], t.elevation[c]]);
  }

  /** Paints one cell in land or biome mode. Water never keeps a biome; new land starts as low plains. */
  private paintCell(t: PaintTarget, brush: Brush, c: number, changed: Map<number, Before>) {
    const land = t.land[c];
    let nextLand = land;
    let nextBiome = t.biome[c];
    let nextElevation = t.elevation[c];
    if (brush.mode === 'land') {
      nextLand = brush.land ? 1 : 0;
      if (!nextLand) {
        nextBiome = 0;
        nextElevation = 0;
      } else if (!land) nextElevation = DEFAULT_LAND_ELEVATION;
    } else {
      if (!land) return false;
      nextBiome = brush.biomeSlot;
    }
    if (nextLand === land && nextBiome === t.biome[c] && nextElevation === t.elevation[c]) return false;
    this.remember(t, c, changed);
    t.land[c] = nextLand;
    t.biome[c] = nextBiome;
    t.elevation[c] = nextElevation;
    return true;
  }

  /** Starts a stroke at map position (x, y). */
  begin(brush: Brush, x: number, y: number) {
    if (!this.target()) return;
    this.stroke = new Map();
    this.last = { x, y };
    this.dab(brush, x, y);
  }

  /** Continues the stroke, with dabs close enough together to leave no gaps. */
  move(brush: Brush, x: number, y: number) {
    if (!this.stroke || !this.last) return;
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const t = this.target();
    const spacing = Math.max(brush.radius * 0.35, (t?.graph.spacing ?? 1) * 0.3);
    if (dist < spacing) return;
    const n = Math.floor(dist / spacing);
    for (let k = 1; k <= n; k++) this.dab(brush, this.last.x + (dx * k) / n, this.last.y + (dy * k) / n);
    this.last = { x, y };
  }

  end() {
    const t = this.target();
    if (t && this.stroke && this.stroke.size) this.record(t, this.stroke);
    this.stroke = null;
    this.last = null;
  }

  private dab(brush: Brush, x: number, y: number) {
    const t = this.target();
    const stroke = this.stroke;
    if (!t || !stroke) return;
    let changed = false;
    if (brush.mode === 'elevation') changed = this.elevationDab(t, brush, x, y, stroke);
    else {
      cellsNear(t.graph, x, y, brush.radius, (c) => {
        if (this.paintCell(t, brush, c, stroke)) changed = true;
      });
      // A brush smaller than a cell still paints the cell under it.
      const under = cellAt(t.graph, x, y);
      if (under >= 0 && this.paintCell(t, brush, under, stroke)) changed = true;
    }
    if (changed) this.onChange(brush.mode);
  }

  /** Set, raise, lower or smooth the elevation of land cells under the brush. Water is left alone (the coast stays painted). */
  private elevationDab(t: PaintTarget, brush: Brush, x: number, y: number, stroke: Map<number, Before>) {
    const g = t.graph;
    const cells: number[] = [];
    cellsNear(g, x, y, brush.radius, (c) => cells.push(c));
    const under = cellAt(g, x, y);
    if (under >= 0 && !cells.includes(under)) cells.push(under);
    // Smoothing reads the heights from before this dab, so cells already smoothed do not count twice.
    const before = brush.op === 'smooth' ? new Map(cells.map((c) => [c, t.elevation[c]])) : null;
    let changed = false;
    for (const c of cells) {
      if (!t.land[c]) continue;
      const e = t.elevation[c];
      const f = falloff(Math.hypot(g.centers[c * 2] - x, g.centers[c * 2 + 1] - y) / Math.max(brush.radius, g.spacing * 0.5));
      let next = e;
      if (brush.op === 'set') next = brush.meters;
      else if (brush.op === 'raise') next = e + brush.meters * f;
      else if (brush.op === 'lower') next = e - brush.meters * f;
      else {
        let sum = e;
        let n = 1;
        for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
          const nb = across(g, g.cellEdges[k], c);
          if (nb < 0 || !t.land[nb]) continue;
          sum += before?.get(nb) ?? t.elevation[nb];
          n++;
        }
        next = e + (sum / n - e) * 0.6 * f;
      }
      next = Math.round(Math.max(0, Math.min(ELEVATION_MAX, next)));
      if (next === e) continue;
      this.remember(t, c, stroke);
      t.elevation[c] = next;
      changed = true;
    }
    return changed;
  }

  /**
   * Fills the connected area around (x, y) (cells sharing an edge): in land mode, the land
   * or water you click; in biome mode, the land cells with the same biome as the one you click.
   * Elevation has no fill.
   */
  fill(brush: Brush, x: number, y: number) {
    const t = this.target();
    if (!t || brush.mode === 'elevation') return;
    const seed = cellAt(t.graph, x, y);
    if (seed < 0) return;
    const g = t.graph;
    const fromLand = t.land[seed];
    const fromBiome = t.biome[seed];
    if (brush.mode === 'biome' && !fromLand) return;
    const same = (c: number) => (brush.mode === 'land' ? t.land[c] === fromLand : t.land[c] === 1 && t.biome[c] === fromBiome);
    const changed = new Map<number, Before>();
    const seen = new Uint8Array(g.cellCount);
    const queue = [seed];
    seen[seed] = 1;
    while (queue.length) {
      const c = queue.pop()!;
      this.paintCell(t, brush, c, changed);
      for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
        const n = across(g, g.cellEdges[k], c);
        if (n < 0 || seen[n] || !same(n)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    if (!changed.size) return;
    this.onChange(brush.mode);
    this.record(t, changed);
  }

  private record(t: PaintTarget, changed: Map<number, Before>) {
    const n = changed.size;
    const step: CellStep = {
      cells: new Int32Array(n),
      before: { land: new Uint8Array(n), biome: new Uint8Array(n), elevation: new Int16Array(n) },
      after: { land: new Uint8Array(n), biome: new Uint8Array(n), elevation: new Int16Array(n) },
    };
    let i = 0;
    for (const [c, [land, biome, elevation]] of changed) {
      step.cells[i] = c;
      step.before.land[i] = land;
      step.before.biome[i] = biome;
      step.before.elevation[i] = elevation;
      step.after.land[i] = t.land[c];
      step.after.biome[i] = t.biome[c];
      step.after.elevation[i] = t.elevation[c];
      i++;
    }
    this.lastPush = null;
    this.undos.push({ cells: step });
    if (this.undos.length > MAX_STEPS) this.undos.shift();
    this.redos = [];
    this.onEdited();
    this.notify();
  }

  undo() {
    this.apply(this.undos, this.redos, false);
  }

  redo() {
    this.apply(this.redos, this.undos, true);
  }

  private apply(from: Step[], to: Step[], forward: boolean) {
    const s = from.pop();
    if (!s) return;
    to.push(s);
    if ('custom' in s) {
      if (forward) s.custom.redo();
      else s.custom.undo();
      this.notify();
      return;
    }
    const t = this.target();
    if (!t) return;
    const data = forward ? s.cells.after : s.cells.before;
    let landChanged = false;
    let elevationChanged = false;
    for (let i = 0; i < s.cells.cells.length; i++) {
      const c = s.cells.cells[i];
      if (t.land[c] !== data.land[i]) landChanged = true;
      if (t.elevation[c] !== data.elevation[i]) elevationChanged = true;
      t.land[c] = data.land[i];
      t.biome[c] = data.biome[i];
      t.elevation[c] = data.elevation[i];
    }
    this.onChange(landChanged ? 'land' : elevationChanged ? 'elevation' : 'biome');
    this.onEdited();
    this.notify();
  }
}
