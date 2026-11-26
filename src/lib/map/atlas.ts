import type { Coast } from './coast';
import { PAPER_TILE_PIXELS, PAPER_TILE_UNITS, paperTexture } from './paper';

// Draws the fantasy-atlas look with the browser's 2D canvas, in map units:
//   parchment paper; the sea tinted and darkened along the coast; rings of waves off the
//   coast; the land darkened just inside the coast; an inked coastline; a frame.
// Sizes are in map units (the map's long side is 1000), so the look scales like a
// printed map when zooming. Thin lines never get thinner than about one screen pixel.

/** Where the map is on screen: map point (mx, my) is at (x + mx * scale, y + my * scale) CSS pixels. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export const ATLAS = {
  ink: '#3b2f22',
  /** Multiplied over the paper on water: a darker brown than the land (Caleb: brown, not blue). */
  sea: '#d6c29e',
  seaShade: 'rgba(96, 70, 40, 0.4)',
  landShade: 'rgba(110, 82, 48, 0.32)',
  /** In map units. */
  coastInk: 0.75,
  seaShadeWidth: 9,
  seaShadeBlur: 3.2,
  landShadeWidth: 5,
  landShadeBlur: 1.8,
  waveCount: 3,
  waveFirst: 2.4,
  waveSpacing: 2.6,
  waveLine: 0.38,
  waveAlpha: 0.5,
  frame: 1.4,
};

function polyPath(path: Path2D, pts: Float32Array, close: boolean) {
  if (pts.length < 4) return;
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  if (close) path.closePath();
}

export class AtlasRenderer {
  private ctx: CanvasRenderingContext2D;
  private layer = document.createElement('canvas');
  private lctx: CanvasRenderingContext2D;
  private pattern: CanvasPattern | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.lctx = this.layer.getContext('2d')!;
  }

  /**
   * Draws the whole visible map. `width` and `height` are the map's size in map units.
   * `quick` leaves out the blurred shading and the waves, for drawing while a brush stroke is under way.
   */
  draw(view: View, width: number, height: number, coast: Coast | null, quick = false) {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    if (this.layer.width !== cw || this.layer.height !== ch) {
      this.layer.width = cw;
      this.layer.height = ch;
    }
    const ctx = this.ctx;
    const s = view.scale * dpr;
    /** One screen pixel in map units. */
    const px = 1 / s;
    const toMap = () => ctx.setTransform(s, 0, 0, s, view.x * dpr, view.y * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    toMap();

    // Paper.
    ctx.save();
    const rect = new Path2D();
    rect.rect(0, 0, width, height);
    ctx.clip(rect);
    if (!this.pattern) this.pattern = ctx.createPattern(paperTexture(), 'repeat');
    if (this.pattern) {
      this.pattern.setTransform(new DOMMatrix().scaleSelf(PAPER_TILE_UNITS / PAPER_TILE_PIXELS));
      ctx.fillStyle = this.pattern;
    } else ctx.fillStyle = '#efe3c4';
    ctx.fillRect(0, 0, width, height);

    const land = new Path2D();
    const shore = new Path2D();
    if (coast) {
      for (const f of coast.fill) polyPath(land, f, true);
      for (const l of coast.lines) polyPath(shore, l.pts, l.closed);
    }
    const sea = new Path2D();
    sea.rect(0, 0, width, height);
    sea.addPath(land);

    // Sea: tint, shade along the coast, waves.
    ctx.save();
    ctx.clip(sea, 'evenodd');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ATLAS.sea;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!quick) {
      ctx.filter = `blur(${ATLAS.seaShadeBlur * s}px)`;
      ctx.strokeStyle = ATLAS.seaShade;
      ctx.lineWidth = ATLAS.seaShadeWidth;
      ctx.stroke(shore);
      ctx.filter = 'none';
      this.drawWaves(view, dpr, shore);
    }
    ctx.restore();

    // Land: darker just inside the coast.
    if (!quick) {
      ctx.save();
      ctx.clip(land, 'evenodd');
      ctx.lineJoin = 'round';
      ctx.filter = `blur(${ATLAS.landShadeBlur * s}px)`;
      ctx.strokeStyle = ATLAS.landShade;
      ctx.lineWidth = ATLAS.landShadeWidth;
      ctx.stroke(shore);
      ctx.filter = 'none';
      ctx.restore();
    }

    // Ink.
    ctx.strokeStyle = ATLAS.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(ATLAS.coastInk, 1.1 * px);
    ctx.stroke(shore);
    ctx.restore();

    // Frame.
    toMap();
    ctx.strokeStyle = ATLAS.ink;
    ctx.lineWidth = Math.max(ATLAS.frame, 1.5 * px);
    ctx.strokeRect(0, 0, width, height);
  }

  /** Rings of waves at set distances off the coast: each ring is a wide stroke with a slightly narrower one cut out of it. */
  private drawWaves(view: View, dpr: number, shore: Path2D) {
    const l = this.lctx;
    const s = view.scale * dpr;
    const line = Math.max(ATLAS.waveLine, 0.8 / s);
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, this.layer.width, this.layer.height);
    l.setTransform(s, 0, 0, s, view.x * dpr, view.y * dpr);
    l.lineJoin = 'round';
    l.lineCap = 'round';
    // Outermost first, so cutting out a ring's inside never removes a ring further out.
    for (let k = ATLAS.waveCount - 1; k >= 0; k--) {
      const d = ATLAS.waveFirst + k * ATLAS.waveSpacing;
      l.globalCompositeOperation = 'source-over';
      l.strokeStyle = '#000';
      l.lineWidth = 2 * d + line;
      l.stroke(shore);
      l.globalCompositeOperation = 'destination-out';
      l.lineWidth = 2 * d - line;
      l.stroke(shore);
    }
    l.globalCompositeOperation = 'source-in';
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.fillStyle = ATLAS.ink;
    l.fillRect(0, 0, this.layer.width, this.layer.height);
    l.globalCompositeOperation = 'source-over';

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = ATLAS.waveAlpha;
    ctx.drawImage(this.layer, 0, 0);
    ctx.restore();
  }
}
