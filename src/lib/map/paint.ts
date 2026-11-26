import { across, cellAt, cellsNear, type Graph } from './graph';

// The land and water tools. They change whole cells, tell the map to redraw after every
// dab, and keep an undo history of whole strokes and fills.

export interface Brush {
  /** Paint land (true) or water (false). */
  land: boolean;
  /** Brush radius in map units. */
  radius: number;
}

interface Step {
  cells: Int32Array;
  before: Uint8Array;
  after: Uint8Array;
}

const MAX_STEPS = 100;

export interface PaintTarget {
  graph: Graph;
  land: Uint8Array;
}

export class LandPainter {
  /** Cells changed in the current stroke, with what they were before it. */
  private stroke: Map<number, number> | null = null;
  private last: { x: number; y: number } | null = null;
  private undos: Step[] = [];
  private redos: Step[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private target: () => PaintTarget | null,
    private onChange: () => void,
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
    if (!t || !this.stroke) return;
    const value = brush.land ? 1 : 0;
    let changed = false;
    const stroke = this.stroke;
    const paint = (c: number) => {
      if (t.land[c] === value) return;
      if (!stroke.has(c)) stroke.set(c, t.land[c]);
      t.land[c] = value;
      changed = true;
    };
    cellsNear(t.graph, x, y, brush.radius, paint);
    // A brush smaller than a cell still paints the cell under it.
    const under = cellAt(t.graph, x, y);
    if (under >= 0) paint(under);
    if (changed) this.onChange();
  }

  /** Fills the connected land or water (cells sharing an edge) around (x, y) with the brush's land or water. */
  fill(brush: Brush, x: number, y: number) {
    const t = this.target();
    if (!t) return;
    const seed = cellAt(t.graph, x, y);
    if (seed < 0) return;
    const value = brush.land ? 1 : 0;
    const from = t.land[seed];
    if (from === value) return;
    const g = t.graph;
    const changed = new Map<number, number>();
    const queue = [seed];
    t.land[seed] = value;
    changed.set(seed, from);
    while (queue.length) {
      const c = queue.pop()!;
      for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
        const n = across(g, g.cellEdges[k], c);
        if (n < 0 || t.land[n] !== from) continue;
        t.land[n] = value;
        changed.set(n, from);
        queue.push(n);
      }
    }
    this.onChange();
    this.record(t, changed);
  }

  private record(t: PaintTarget, changed: Map<number, number>) {
    const cells = new Int32Array(changed.size);
    const before = new Uint8Array(changed.size);
    const after = new Uint8Array(changed.size);
    let i = 0;
    for (const [c, was] of changed) {
      cells[i] = c;
      before[i] = was;
      after[i] = t.land[c];
      i++;
    }
    this.undos.push({ cells, before, after });
    if (this.undos.length > MAX_STEPS) this.undos.shift();
    this.redos = [];
    this.onEdited();
    this.notify();
  }

  undo() {
    this.apply(this.undos, this.redos, 'before');
  }

  redo() {
    this.apply(this.redos, this.undos, 'after');
  }

  private apply(from: Step[], to: Step[], which: 'before' | 'after') {
    const t = this.target();
    const s = from.pop();
    if (!t || !s) return;
    for (let i = 0; i < s.cells.length; i++) t.land[s.cells[i]] = s[which][i];
    to.push(s);
    this.onChange();
    this.onEdited();
    this.notify();
  }
}
