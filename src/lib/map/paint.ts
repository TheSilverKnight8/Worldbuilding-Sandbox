import { across, cellAt, cellsNear, type Graph } from './graph';

// The painting tools: land and water (Stage 2) and biomes (Stage 3). They change whole
// cells, tell the map to redraw after every dab, and keep an undo history of whole
// strokes and fills, covering both land and biomes.

export type PaintMode = 'land' | 'biome';

export interface Brush {
  mode: PaintMode;
  /** Land mode: paint land (true) or water (false). */
  land: boolean;
  /** Biome mode: the biome slot to paint; 0 erases the biome. */
  biomeSlot: number;
  /** Brush radius in map units. */
  radius: number;
}

export interface PaintTarget {
  graph: Graph;
  land: Uint8Array;
  biome: Uint8Array;
}

interface Step {
  cells: Int32Array;
  landBefore: Uint8Array;
  landAfter: Uint8Array;
  biomeBefore: Uint8Array;
  biomeAfter: Uint8Array;
}

const MAX_STEPS = 100;

export class MapPainter {
  /** Cells changed in the current stroke, with their land and biome before it. */
  private stroke: Map<number, [number, number]> | null = null;
  private last: { x: number; y: number } | null = null;
  private undos: Step[] = [];
  private redos: Step[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private target: () => PaintTarget | null,
    private onChange: (what: 'land' | 'biome') => void,
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

  /** Paints one cell; remembers what it was. Water never keeps a biome (biomes are for land). */
  private paintCell(t: PaintTarget, brush: Brush, c: number, changed: Map<number, [number, number]>) {
    const land = t.land[c];
    const biome = t.biome[c];
    let nextLand = land;
    let nextBiome = biome;
    if (brush.mode === 'land') {
      nextLand = brush.land ? 1 : 0;
      if (!nextLand) nextBiome = 0;
    } else {
      if (!land) return false;
      nextBiome = brush.biomeSlot;
    }
    if (nextLand === land && nextBiome === biome) return false;
    if (!changed.has(c)) changed.set(c, [land, biome]);
    t.land[c] = nextLand;
    t.biome[c] = nextBiome;
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
    cellsNear(t.graph, x, y, brush.radius, (c) => {
      if (this.paintCell(t, brush, c, stroke)) changed = true;
    });
    // A brush smaller than a cell still paints the cell under it.
    const under = cellAt(t.graph, x, y);
    if (under >= 0 && this.paintCell(t, brush, under, stroke)) changed = true;
    if (changed) this.onChange(brush.mode);
  }

  /**
   * Fills the connected area around (x, y) (cells sharing an edge): in land mode, the land
   * or water you click; in biome mode, the land cells with the same biome as the one you click.
   */
  fill(brush: Brush, x: number, y: number) {
    const t = this.target();
    if (!t) return;
    const seed = cellAt(t.graph, x, y);
    if (seed < 0) return;
    const g = t.graph;
    const fromLand = t.land[seed];
    const fromBiome = t.biome[seed];
    if (brush.mode === 'biome' && !fromLand) return;
    const same = (c: number) => (brush.mode === 'land' ? t.land[c] === fromLand : t.land[c] === 1 && t.biome[c] === fromBiome);
    const changed = new Map<number, [number, number]>();
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

  private record(t: PaintTarget, changed: Map<number, [number, number]>) {
    const n = changed.size;
    const step: Step = { cells: new Int32Array(n), landBefore: new Uint8Array(n), landAfter: new Uint8Array(n), biomeBefore: new Uint8Array(n), biomeAfter: new Uint8Array(n) };
    let i = 0;
    for (const [c, [land, biome]] of changed) {
      step.cells[i] = c;
      step.landBefore[i] = land;
      step.biomeBefore[i] = biome;
      step.landAfter[i] = t.land[c];
      step.biomeAfter[i] = t.biome[c];
      i++;
    }
    this.undos.push(step);
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

  private apply(from: Step[], to: Step[], after: boolean) {
    const t = this.target();
    const s = from.pop();
    if (!t || !s) return;
    const land = after ? s.landAfter : s.landBefore;
    const biome = after ? s.biomeAfter : s.biomeBefore;
    let landChanged = false;
    for (let i = 0; i < s.cells.length; i++) {
      if (t.land[s.cells[i]] !== land[i]) landChanged = true;
      t.land[s.cells[i]] = land[i];
      t.biome[s.cells[i]] = biome[i];
    }
    to.push(s);
    this.onChange(landChanged ? 'land' : 'biome');
    this.onEdited();
    this.notify();
  }
}
