import { NO_BIOME_COLOR, type SlotLook } from './biomes';
import { addCell, cellShapes } from './cells';
import type { Coast } from './coast';
import type { Graph } from './graph';
import { ROTATABLE, minPixels, sprite, type IconStyle, type Placement } from './icons';
import type { NoisyEdges } from './noisy';
import { PAPER_TILE_PIXELS, PAPER_TILE_UNITS, paperTexture } from './paper';

// Draws the map with the browser's 2D canvas, in map units, in one of two looks:
//
// Fantasy atlas (Stage 2, matched to Caleb's own Nortantis map in Stage 4): parchment;
//   a pale sea and darker olive-tan land; land darkened in a band just inside the coast,
//   a thin shadow just off it; an inked coastline; icons in ink; a frame.
// Painterly (Stage 3): a blue sea, lighter along the coast; land in its biome colors,
//   blended softly into each other; a soft coastline; biome icons in color; the paper's
//   texture showing through, like paint on paper; a frame.
//
// Sizes are in map units (the map's long side is 1000), so the look scales like a
// printed map when zooming. Thin lines never get thinner than about one screen pixel.

/** Where the map is on screen: map point (mx, my) is at (x + mx * scale, y + my * scale) CSS pixels. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export type MapStyle = IconStyle;

export const ATLAS = {
  ink: '#3b2f22',
  /**
   * Multiplied over the paper. Matched to Caleb's own Nortantis map: the sea pale (about
   * #d8c5a6 there) and the land a darker olive tan (about #b7a97e).
   */
  sea: '#ece6e4',
  land: '#c8c6ae',
  /** A thin shadow just off the coast, and a darker band just inside it. In map units. */
  seaShade: 'rgba(70, 56, 36, 0.3)',
  seaShadeWidth: 3,
  seaShadeBlur: 0.8,
  landShade: 'rgba(78, 62, 36, 0.45)',
  landShadeWidth: 10,
  landShadeBlur: 2.2,
  coastInk: 0.75,
  frame: 1.4,
};

export const PAINTERLY = {
  /** Open sea, and the lighter water along the coast (Caleb: blue on the painterly map). */
  sea: '#7ea6c6',
  shallows: 'rgba(196, 222, 236, 0.55)',
  shallowsWidth: 14,
  shallowsBlur: 5,
  coast: 'rgba(38, 56, 72, 0.7)',
  coastLine: 0.55,
  /** How soft the edges between biome colors are, in map units. */
  blend: 2.4,
  /** How strongly the paper texture shows through (multiplied). */
  paper: 0.45,
  frame: 1.4,
  frameColor: '#2f3a44',
};

/** The painterly land colors, one per cell, kept in a picture that is repainted only where land or biomes change. */
const FIELD_PER_UNIT = 2;

/** Everything the renderer needs to draw a map. */
export interface Scene {
  graph: Graph;
  land: Uint8Array;
  biome: Uint8Array;
  coast: Coast | null;
  looks: (SlotLook | null)[];
  /** All icons to draw (biome plants, the app's hills and mountains, icons placed by hand), sorted top to bottom. */
  icons: Placement[];
  /** Final elevation per cell, in meters (Stage 4). */
  heights: Int16Array;
  /** Draw the elevation overlay (height colors and contour lines). */
  overlay: boolean;
  noisy: NoisyEdges;
}

/**
 * The elevation overlay: land colored by height (covering the biome colors while it is on,
 * so it cannot be mistaken for them), and a contour line every `contour` meters (heavier
 * every `contourMajor`). The key under the map shows the same stops.
 */
export const OVERLAY = {
  stops: [
    [0, '#4f8c6c'],
    [250, '#8db87c'],
    [600, '#d9d58f'],
    [1000, '#e8bb76'],
    [1500, '#cf8d55'],
    [2500, '#9a6447'],
    [3500, '#7d6a64'],
    [5000, '#f3f1ed'],
  ] as [number, string][],
  alpha: 0.94,
  blend: 1.6,
  contour: 250,
  contourMajor: 1000,
  line: 'rgba(60, 38, 20, 0.6)',
  /** How solid the icons are drawn over the overlay. */
  iconAlpha: 0.5,
};

function heightColor(h: number) {
  const stops = OVERLAY.stops;
  if (h <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (h > stops[i][0]) continue;
    const [h0, c0] = stops[i - 1];
    const [h1, c1] = stops[i];
    const t = (h - h0) / (h1 - h0);
    const a = parseInt(c0.slice(1), 16);
    const b = parseInt(c1.slice(1), 16);
    const mix = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t);
    return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
  }
  return stops[stops.length - 1][1];
}

function polyPath(path: Path2D, pts: Float32Array, close: boolean) {
  if (pts.length < 4) return;
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  if (close) path.closePath();
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx: CanvasRenderingContext2D;
  private field = document.createElement('canvas');
  private fieldState: { graph: Graph; looksKey: string; land: Uint8Array; biome: Uint8Array } | null = null;
  private heightField = document.createElement('canvas');
  private heightState: { graph: Graph; land: Uint8Array; heights: Int16Array } | null = null;
  private contours: { heights: Int16Array; land: Uint8Array; minor: Path2D; major: Path2D } | null = null;
  private pattern: CanvasPattern | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.lctx = this.layer.getContext('2d')!;
  }

  /**
   * Draws the whole visible map. `quick` leaves out the blurred shading and the
   * soft blending, for drawing while a brush stroke is under way.
   */
  draw(view: View, scene: Scene, style: MapStyle, quick = false) {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    for (const c of [this.canvas, this.layer])
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
    const ctx = this.ctx;
    const g = scene.graph;
    const s = view.scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(s, 0, 0, s, view.x * dpr, view.y * dpr);

    const land = new Path2D();
    const shore = new Path2D();
    if (scene.coast) {
      for (const f of scene.coast.fill) polyPath(land, f, true);
      for (const l of scene.coast.lines) polyPath(shore, l.pts, l.closed);
    }
    const sea = new Path2D();
    sea.rect(0, 0, g.width, g.height);
    sea.addPath(land);

    ctx.save();
    const rect = new Path2D();
    rect.rect(0, 0, g.width, g.height);
    ctx.clip(rect);
    if (style === 'atlas') this.drawAtlas(view, dpr, scene, land, shore, sea, quick);
    else this.drawPainterly(view, dpr, scene, land, shore, sea, quick);
    ctx.restore();

    if (scene.overlay) {
      ctx.save();
      ctx.clip(rect);
      this.drawOverlay(view, dpr, scene, land);
      ctx.restore();
    }

    this.drawIcons(view, dpr, scene, style);

    // Frame.
    ctx.setTransform(s, 0, 0, s, view.x * dpr, view.y * dpr);
    ctx.strokeStyle = style === 'atlas' ? ATLAS.ink : PAINTERLY.frameColor;
    ctx.lineWidth = Math.max(ATLAS.frame, 1.5 / s);
    ctx.strokeRect(0, 0, g.width, g.height);
  }

  private paper(ctx: CanvasRenderingContext2D) {
    if (!this.pattern) this.pattern = ctx.createPattern(paperTexture(), 'repeat');
    if (!this.pattern) return '#efe3c4';
    this.pattern.setTransform(new DOMMatrix().scaleSelf(PAPER_TILE_UNITS / PAPER_TILE_PIXELS));
    return this.pattern;
  }

  private drawAtlas(view: View, dpr: number, scene: Scene, land: Path2D, shore: Path2D, sea: Path2D, quick: boolean) {
    const ctx = this.ctx;
    const g = scene.graph;
    const s = view.scale * dpr;
    ctx.fillStyle = this.paper(ctx);
    ctx.fillRect(0, 0, g.width, g.height);

    // Sea: a pale tint, and a thin shadow just off the coast.
    ctx.save();
    ctx.clip(sea, 'evenodd');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ATLAS.sea;
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!quick) {
      ctx.filter = `blur(${ATLAS.seaShadeBlur * s}px)`;
      ctx.strokeStyle = ATLAS.seaShade;
      ctx.lineWidth = ATLAS.seaShadeWidth;
      ctx.stroke(shore);
      ctx.filter = 'none';
    }
    ctx.restore();

    // Land: a darker olive-tan tint, darker still in a band just inside the coast.
    ctx.save();
    ctx.clip(land, 'evenodd');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ATLAS.land;
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.globalCompositeOperation = 'source-over';
    if (!quick) {
      ctx.lineJoin = 'round';
      ctx.filter = `blur(${ATLAS.landShadeBlur * s}px)`;
      ctx.strokeStyle = ATLAS.landShade;
      ctx.lineWidth = ATLAS.landShadeWidth;
      ctx.stroke(shore);
      ctx.filter = 'none';
    }
    ctx.restore();

    // Ink.
    ctx.strokeStyle = ATLAS.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(ATLAS.coastInk, 1.1 / s);
    ctx.stroke(shore);
  }

  private drawPainterly(view: View, dpr: number, scene: Scene, land: Path2D, shore: Path2D, sea: Path2D, quick: boolean) {
    const ctx = this.ctx;
    const g = scene.graph;
    const s = view.scale * dpr;

    // Sea: blue, lighter along the coast.
    ctx.save();
    ctx.clip(sea, 'evenodd');
    ctx.fillStyle = PAINTERLY.sea;
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!quick) ctx.filter = `blur(${PAINTERLY.shallowsBlur * s}px)`;
    ctx.strokeStyle = PAINTERLY.shallows;
    ctx.lineWidth = PAINTERLY.shallowsWidth;
    ctx.stroke(shore);
    ctx.filter = 'none';
    ctx.restore();

    // Land: biome colors, blended softly.
    this.updateField(scene);
    ctx.save();
    ctx.clip(land, 'evenodd');
    if (!quick) ctx.filter = `blur(${PAINTERLY.blend * s}px)`;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.field, 0, 0, g.width, g.height);
    ctx.filter = 'none';
    ctx.restore();

    // Paper texture through the paint.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = PAINTERLY.paper;
    ctx.fillStyle = this.paper(ctx);
    ctx.fillRect(0, 0, g.width, g.height);
    ctx.restore();

    // Coastline.
    ctx.strokeStyle = PAINTERLY.coast;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(PAINTERLY.coastLine, 1 / s);
    ctx.stroke(shore);
  }

  /**
   * Keeps the field picture (each cell in its painterly color) up to date. After the first
   * full paint, only cells whose land or biome changed are repainted, with their
   * neighbors, so painting stays quick. Colors changing means a full repaint.
   */
  private updateField(scene: Scene) {
    const g = scene.graph;
    const fw = Math.ceil(g.width * FIELD_PER_UNIT);
    const fh = Math.ceil(g.height * FIELD_PER_UNIT);
    const looksKey = scene.looks.map((l) => (l ? l.color : '')).join(',');
    const f = this.field.getContext('2d')!;
    const shapes = cellShapes(g);
    const st = this.fieldState;
    const full = !st || st.graph !== g || st.looksKey !== looksKey || this.field.width !== fw || this.field.height !== fh;
    /** A cell's color: land in its biome's color; water next to land takes that land's color, so blending never pulls a pale fringe into the coast. */
    const colorOf = (c: number) => {
      if (scene.land[c]) return scene.looks[scene.biome[c]]?.color ?? NO_BIOME_COLOR;
      for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
        const e = g.cellEdges[k];
        const n = g.edges[e * 4 + 2] === c ? g.edges[e * 4 + 3] : g.edges[e * 4 + 2];
        if (n >= 0 && scene.land[n]) return scene.looks[scene.biome[n]]?.color ?? NO_BIOME_COLOR;
      }
      return NO_BIOME_COLOR;
    };
    const paint = (cells: Iterable<number>) => {
      const paths = new Map<string, Path2D>();
      for (const c of cells) {
        const color = colorOf(c);
        let p = paths.get(color);
        if (!p) paths.set(color, (p = new Path2D()));
        addCell(p, shapes, c);
      }
      for (const [color, p] of paths) {
        f.fillStyle = color;
        f.fill(p);
        // A hairline of the same color closes tiny gaps between neighboring cells.
        f.strokeStyle = color;
        f.lineWidth = 0.6;
        f.stroke(p);
      }
    };
    if (full) {
      this.field.width = fw;
      this.field.height = fh;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.fillStyle = NO_BIOME_COLOR;
      f.fillRect(0, 0, fw, fh);
      f.setTransform(FIELD_PER_UNIT, 0, 0, FIELD_PER_UNIT, 0, 0);
      const all: number[] = [];
      for (let c = 0; c < g.cellCount; c++) if (colorOf(c) !== NO_BIOME_COLOR) all.push(c);
      paint(all);
      this.fieldState = { graph: g, looksKey, land: scene.land.slice(), biome: scene.biome.slice() };
      return;
    }
    const affected = new Set<number>();
    for (let c = 0; c < g.cellCount; c++) {
      if (st.land[c] === scene.land[c] && st.biome[c] === scene.biome[c]) continue;
      st.land[c] = scene.land[c];
      st.biome[c] = scene.biome[c];
      affected.add(c);
      for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
        const e = g.cellEdges[k];
        const n = g.edges[e * 4 + 2] === c ? g.edges[e * 4 + 3] : g.edges[e * 4 + 2];
        if (n >= 0) affected.add(n);
      }
    }
    if (affected.size) {
      f.setTransform(FIELD_PER_UNIT, 0, 0, FIELD_PER_UNIT, 0, 0);
      paint(affected);
    }
  }

  /** The elevation overlay: land tinted by height (softly blended), with contour lines along cell edges. */
  private drawOverlay(view: View, dpr: number, scene: Scene, land: Path2D) {
    const ctx = this.ctx;
    const g = scene.graph;
    const s = view.scale * dpr;
    this.updateHeightField(scene);
    ctx.save();
    ctx.clip(land, 'evenodd');
    ctx.globalAlpha = OVERLAY.alpha;
    ctx.filter = `blur(${OVERLAY.blend * s}px)`;
    ctx.drawImage(this.heightField, 0, 0, g.width, g.height);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    const c = this.contourPaths(scene);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = OVERLAY.line;
    ctx.lineWidth = Math.max(0.35, 0.9 / s);
    ctx.stroke(c.minor);
    ctx.lineWidth = Math.max(0.8, 1.8 / s);
    ctx.stroke(c.major);
    ctx.restore();
  }

  /** Height colors per cell, repainted only where heights or land changed. */
  private updateHeightField(scene: Scene) {
    const g = scene.graph;
    const fw = Math.ceil(g.width * FIELD_PER_UNIT);
    const fh = Math.ceil(g.height * FIELD_PER_UNIT);
    const f = this.heightField.getContext('2d')!;
    const shapes = cellShapes(g);
    const st = this.heightState;
    const colorOf = (c: number) => {
      if (scene.land[c]) return heightColor(scene.heights[c]);
      for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
        const e = g.cellEdges[k];
        const n = g.edges[e * 4 + 2] === c ? g.edges[e * 4 + 3] : g.edges[e * 4 + 2];
        if (n >= 0 && scene.land[n]) return heightColor(scene.heights[n]);
      }
      return heightColor(0);
    };
    const paint = (cells: Iterable<number>) => {
      const paths = new Map<string, Path2D>();
      for (const c of cells) {
        const color = colorOf(c);
        let p = paths.get(color);
        if (!p) paths.set(color, (p = new Path2D()));
        addCell(p, shapes, c);
      }
      for (const [color, p] of paths) {
        f.fillStyle = color;
        f.fill(p);
        f.strokeStyle = color;
        f.lineWidth = 0.6;
        f.stroke(p);
      }
    };
    if (!st || st.graph !== g || this.heightField.width !== fw || this.heightField.height !== fh) {
      this.heightField.width = fw;
      this.heightField.height = fh;
      f.setTransform(FIELD_PER_UNIT, 0, 0, FIELD_PER_UNIT, 0, 0);
      const all: number[] = [];
      for (let c = 0; c < g.cellCount; c++) all.push(c);
      paint(all);
      this.heightState = { graph: g, land: scene.land.slice(), heights: scene.heights.slice() };
      return;
    }
    const affected = new Set<number>();
    for (let c = 0; c < g.cellCount; c++) {
      if (st.land[c] === scene.land[c] && st.heights[c] === scene.heights[c]) continue;
      st.land[c] = scene.land[c];
      st.heights[c] = scene.heights[c];
      affected.add(c);
      for (let k = g.cellEdgeStart[c]; k < g.cellEdgeStart[c + 1]; k++) {
        const e = g.cellEdges[k];
        const n = g.edges[e * 4 + 2] === c ? g.edges[e * 4 + 3] : g.edges[e * 4 + 2];
        if (n >= 0) affected.add(n);
      }
    }
    if (affected.size) {
      f.setTransform(FIELD_PER_UNIT, 0, 0, FIELD_PER_UNIT, 0, 0);
      paint(affected);
    }
  }

  /** Contour lines: the (wiggly) edges between land cells whose heights fall in different bands. */
  private contourPaths(scene: Scene) {
    const c = this.contours;
    if (c && c.heights === scene.heights && c.land === scene.land) return c;
    const g = scene.graph;
    const minor = new Path2D();
    const major = new Path2D();
    for (let e = 0; e < g.edgeCount; e++) {
      const a = g.edges[e * 4 + 2];
      const b = g.edges[e * 4 + 3];
      if (b < 0 || !scene.land[a] || !scene.land[b]) continue;
      const ha = scene.heights[a];
      const hb = scene.heights[b];
      const ba = Math.floor(ha / OVERLAY.contour);
      const bb = Math.floor(hb / OVERLAY.contour);
      if (ba === bb) continue;
      const isMajor = Math.floor(ha / OVERLAY.contourMajor) !== Math.floor(hb / OVERLAY.contourMajor);
      const path = isMajor ? major : minor;
      const pts = scene.noisy.get(e);
      path.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
    }
    this.contours = { heights: scene.heights, land: scene.land, minor, major };
    return this.contours;
  }

  /** Biome icons, stamped in screen pixels so they stay crisp. Icons too small to read at this zoom are left out. */
  private drawIcons(view: View, dpr: number, scene: Scene, style: MapStyle) {
    if (!scene.icons.length) return;
    // With the elevation overlay on, the icons are drawn on a layer and laid over the map
    // half see-through, so the height colors show under the mountains.
    const faded = scene.overlay;
    const ctx = faded ? this.lctx : this.ctx;
    if (faded) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.layer.width, this.layer.height);
    }
    const s = view.scale * dpr;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ox = view.x * dpr;
    const oy = view.y * dpr;
    for (const p of scene.icons) {
      const px = Math.round((p.size * s) / 2) * 2;
      if (px < minPixels(p.set)) continue;
      const x = ox + p.x * s;
      const y = oy + p.y * s;
      if (x < -px || y < -px * 0.2 || x > cw + px || y > ch + px * 1.3) continue;
      const sp = sprite(p.set, p.variant, px, style);
      if (p.angle && ROTATABLE.has(p.set)) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((p.angle * Math.PI) / 180);
        ctx.drawImage(sp.canvas, -sp.ax, -sp.ay);
        ctx.restore();
      } else ctx.drawImage(sp.canvas, Math.round(x - sp.ax), Math.round(y - sp.ay));
    }
    ctx.restore();
    if (faded) {
      const main = this.ctx;
      main.save();
      main.setTransform(1, 0, 0, 1, 0, 0);
      main.globalAlpha = OVERLAY.iconAlpha;
      main.drawImage(this.layer, 0, 0);
      main.restore();
    }
  }
}
