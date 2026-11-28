import type { MapText, TextKind } from '../world/types';

// Map text (Stage 8): the kinds Nortantis has (Caleb), each with its own font and size, in
// Caleb's pick of fonts (set A, "Engraved": Cinzel Decorative for the title, Cinzel for
// regions, IM Fell English for the rest; all SIL Open Font License, bundled with the app).
// Text is part of the map: it grows and shrinks with it. A soft paper-colored edge behind the
// letters keeps them readable over icons (Caleb: keep it). Text can be turned, broken over
// lines, curved along a line, and sized on its own.

export interface TextStyle {
  label: string;
  family: string;
  weight: number;
  italic: boolean;
  /** Letter height, in cell spacings, at size 100%. */
  size: number;
  /** Space between letters, as a share of the letter height. */
  spacing: number;
  caps: boolean;
}

export const TEXT_KINDS: readonly TextKind[] = ['title', 'region', 'range', 'mountain', 'city', 'lake', 'river', 'road'];

export const TEXT_STYLES: Record<TextKind, TextStyle> = {
  title: { label: 'Title', family: 'Cinzel Decorative', weight: 700, italic: false, size: 2.3, spacing: 0.06, caps: true },
  region: { label: 'Region', family: 'Cinzel', weight: 600, italic: false, size: 1.5, spacing: 0.45, caps: true },
  range: { label: 'Mountain range', family: 'IM Fell English SC', weight: 400, italic: false, size: 1.1, spacing: 0.3, caps: true },
  mountain: { label: 'Other mountains', family: 'IM Fell English', weight: 400, italic: false, size: 0.85, spacing: 0.02, caps: false },
  city: { label: 'City', family: 'IM Fell English', weight: 400, italic: false, size: 0.95, spacing: 0.02, caps: false },
  lake: { label: 'Lake', family: 'IM Fell English', weight: 400, italic: true, size: 0.9, spacing: 0.04, caps: false },
  river: { label: 'River', family: 'IM Fell English', weight: 400, italic: true, size: 0.85, spacing: 0.06, caps: false },
  road: { label: 'Road', family: 'IM Fell English', weight: 400, italic: true, size: 0.7, spacing: 0.04, caps: false },
};

/** Text sizes allowed, as a share of the kind's size. */
export const TEXT_SCALE_MIN = 0.3;
export const TEXT_SCALE_MAX = 4;

type Pt = [number, number];

/** The CSS font for a kind at a letter height of `px`. */
export const fontOf = (st: TextStyle, px: number) => `${st.italic ? 'italic ' : ''}${st.weight} ${px}px "${st.family}"`;

let fontsReady: Promise<unknown> | null = null;
/** Loads the map's fonts (once); resolves when they can be drawn with. */
export function loadMapFonts(): Promise<unknown> {
  if (!fontsReady)
    fontsReady = Promise.all(
      TEXT_KINDS.map((k) => {
        const st = TEXT_STYLES[k];
        return document.fonts.load(fontOf(st, 20), 'AaZz').catch(() => null);
      }),
    );
  return fontsReady;
}

/** A text's letter height in map units. */
export const textHeight = (t: MapText, spacing: number) => TEXT_STYLES[t.kind].size * spacing * (t.scale ?? 1);

/** The words as drawn: caps for the kinds written in capitals. */
const wordsOf = (t: MapText) => (TEXT_STYLES[t.kind].caps ? t.text.toUpperCase() : t.text);

/** A text's lines, with a little width measured for each (map units). */
function measureLines(ctx: CanvasRenderingContext2D, t: MapText, h: number) {
  const st = TEXT_STYLES[t.kind];
  ctx.font = fontOf(st, h);
  const sp = st.spacing * h;
  return wordsOf(t)
    .split('\n')
    .map((line) => {
      const chars = [...line];
      const widths = chars.map((ch) => ctx.measureText(ch).width);
      const width = widths.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1);
      return { line, chars, widths, width };
    });
}

/** Points along a line, and how far along each is. */
function runOf(pts: Pt[]) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}

/** Where a line is `s` along it, and which way it runs there. */
function along(pts: Pt[], run: number[], s: number): { p: Pt; a: number } {
  let i = 1;
  while (i < pts.length - 1 && run[i] < s) i++;
  const seg = run[i] - run[i - 1] || 1;
  const t = Math.max(-0.5, Math.min(1.5, (s - run[i - 1]) / seg));
  const [ax, ay] = pts[i - 1];
  const [bx, by] = pts[i];
  return { p: [ax + (bx - ax) * t, ay + (by - ay) * t], a: Math.atan2(by - ay, bx - ax) };
}

/** The curve a curved text follows, in map units, running left to right so the letters stand upright. */
function curveOf(t: MapText): Pt[] | null {
  if (!t.curve || t.curve.length < 2) return null;
  const pts: Pt[] = t.curve.map(([dx, dy]) => [t.x + dx, t.y + dy]);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  return b[0] < a[0] ? pts.reverse() : pts;
}

export interface TextColors {
  ink: string;
  /** The soft edge behind the letters. */
  edge: string;
}

/** Draws map texts onto ctx, which is set to map units. `minPx` is a map unit's size on screen (for leaving out text too small to read). */
export function drawTexts(ctx: CanvasRenderingContext2D, texts: MapText[], spacing: number, colors: TextColors, unitPx: number) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  for (const t of texts) {
    const h = textHeight(t, spacing);
    if (h * unitPx < 2.5) continue;
    const st = TEXT_STYLES[t.kind];
    const lines = measureLines(ctx, t, h);
    const sp = st.spacing * h;
    ctx.font = fontOf(st, h);
    // Every letter twice: first its soft edge, then the ink, so the edges never cover letters.
    for (const pass of ['edge', 'ink'] as const) {
      if (pass === 'edge') {
        ctx.strokeStyle = colors.edge;
        ctx.lineWidth = h * 0.24;
      } else ctx.fillStyle = colors.ink;
      const put = (ch: string, x: number, y: number, a: number) => {
        ctx.save();
        ctx.translate(x, y);
        if (a) ctx.rotate(a);
        if (pass === 'edge') ctx.strokeText(ch, 0, 0);
        else ctx.fillText(ch, 0, 0);
        ctx.restore();
      };
      const curve = curveOf(t);
      if (curve) {
        // Along the curve, centered on it, the letters standing on it.
        const run = runOf(curve);
        const { chars, widths, width } = lines[0];
        let s = (run[run.length - 1] - width) / 2;
        chars.forEach((ch, i) => {
          const mid = s + widths[i] / 2;
          const { p, a } = along(curve, run, mid);
          const ox = -widths[i] / 2;
          const oy = -h * 0.42;
          put(ch, p[0] + ox * Math.cos(a) - oy * Math.sin(a), p[1] + ox * Math.sin(a) + oy * Math.cos(a), a);
          s += widths[i] + sp;
        });
        continue;
      }
      const a = ((t.angle ?? 0) * Math.PI) / 180;
      const lh = h * 1.2;
      lines.forEach((ln, li) => {
        const y0 = (li - (lines.length - 1) / 2) * lh;
        let x0 = -ln.width / 2;
        ln.chars.forEach((ch, i) => {
          const [lx, ly] = [x0, y0];
          put(ch, t.x + lx * Math.cos(a) - ly * Math.sin(a), t.y + lx * Math.sin(a) + ly * Math.cos(a), a);
          x0 += ln.widths[i] + sp;
        });
      });
    }
  }
  ctx.restore();
}

/** The outline around a text (map units), for picking it and showing it selected: a box for straight text, a band along a curve. */
export function textOutline(ctx: CanvasRenderingContext2D, t: MapText, spacing: number): Pt[] {
  const h = textHeight(t, spacing);
  const lines = measureLines(ctx, t, h);
  const curve = curveOf(t);
  if (curve) {
    const run = runOf(curve);
    const width = lines[0].width;
    const s0 = (run[run.length - 1] - width) / 2;
    const top: Pt[] = [];
    const bottom: Pt[] = [];
    for (let k = 0; k <= 12; k++) {
      const { p, a } = along(curve, run, s0 + (width * k) / 12);
      const [nx, ny] = [-Math.sin(a), Math.cos(a)];
      top.push([p[0] - nx * h * 0.95, p[1] - ny * h * 0.95]);
      bottom.push([p[0] + nx * h * 0.15, p[1] + ny * h * 0.15]);
    }
    return [...top, ...bottom.reverse()];
  }
  const w = Math.max(...lines.map((l) => l.width)) / 2 + h * 0.15;
  const hh = (lines.length * h * 1.2) / 2;
  const a = ((t.angle ?? 0) * Math.PI) / 180;
  return ([[-w, -hh], [w, -hh], [w, hh], [-w, hh]] as Pt[]).map(([x, y]) => [t.x + x * Math.cos(a) - y * Math.sin(a), t.y + x * Math.sin(a) + y * Math.cos(a)]);
}

function inside(poly: Pt[], x: number, y: number) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}

/** The text at map point (x, y), the one drawn last (on top) first; null if none. */
export function textAt(ctx: CanvasRenderingContext2D, texts: MapText[], x: number, y: number, spacing: number): string | null {
  for (let i = texts.length - 1; i >= 0; i--) if (inside(textOutline(ctx, texts[i], spacing), x, y)) return texts[i].id;
  return null;
}

/** A canvas to measure text with, when none is at hand. */
let measurer: CanvasRenderingContext2D | null = null;
export function measureContext() {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  return measurer;
}
