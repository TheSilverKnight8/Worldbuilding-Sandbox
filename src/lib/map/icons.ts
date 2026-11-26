import { mixSeed, seededRandom } from '../rng';
import type { IconKind } from '../world/types';
import type { SlotLook } from './biomes';
import type { Graph } from './graph';

/** Icons with a direction are drawn centered on their point, so they can turn around it. */
export const ROTATABLE = new Set<IconKind>(['valley', 'canyon', 'cliff']);

// Map icons drawn in code (no image files), in two styles: ink on paper for the atlas,
// color for the painterly map. Each icon is drawn once into a small picture (a sprite)
// at the size it shows on screen, then stamped wherever it is placed. Built as one
// swappable set, so hand-drawn art could replace these drawings later.

export type IconStyle = 'atlas' | 'painterly';
export const VARIANTS = 3;

const INK = '#3b2f22';
const PAPER = '#f3e9d0';

/** Colors per icon on the painterly map: fill, lighter or second color, outline. */
const PAINT: Record<IconKind, [string, string, string]> = {
  hill: ['#a99d6b', '#8b7f55', '#5a5032'],
  mountain: ['#c2ab88', '#8d7559', '#4a3b2c'],
  volcano: ['#a08a72', '#76604c', '#3e3026'],
  plateau: ['#cfae78', '#a07d52', '#6b5233'],
  valley: ['#6f8f58', '#8fb070', '#3f5532'],
  canyon: ['#5a3a26', '#b06d42', '#3a2216'],
  cliff: ['#8a7a60', '#a8987a', '#3e3426'],
  pass: ['#6b5a40', '#8a7756', '#3e3426'],
  deciduous: ['#4f7f3f', '#7aa65c', '#2c4a25'],
  pine: ['#2f5a42', '#4d7a5c', '#1c3528'],
  jungle: ['#2e6e3c', '#4f9452', '#1a4224'],
  cactus: ['#6f9a55', '#93b874', '#3d5a2e'],
  shrub: ['#6e8a4a', '#93ad6b', '#3f5230'],
  grass: ['#7a9a4a', '#9ab86a', '#56703a'],
  dunes: ['#c9a865', '#e3cc8e', '#8a6c38'],
  reeds: ['#5c7a48', '#86a36a', '#33472a'],
};

/**
 * Icon height (or width, for dunes) relative to the map's cell spacing, how many to place
 * per cell, and the smallest size in screen pixels worth drawing. Below that, small icons
 * (grass, reeds, shrubs) turn into specks, so they only appear once zoomed in.
 */
const SPEC: Record<IconKind, { size: number; perCell: number; minPx: number }> = {
  hill: { size: 1, perCell: 0, minPx: 5 },
  mountain: { size: 1, perCell: 0, minPx: 5 },
  volcano: { size: 1, perCell: 0, minPx: 5 },
  plateau: { size: 1, perCell: 0, minPx: 6 },
  valley: { size: 1, perCell: 0, minPx: 8 },
  canyon: { size: 1, perCell: 0, minPx: 8 },
  cliff: { size: 1, perCell: 0, minPx: 8 },
  pass: { size: 1, perCell: 0, minPx: 6 },
  deciduous: { size: 0.95, perCell: 2, minPx: 5 },
  pine: { size: 1.05, perCell: 2, minPx: 5 },
  jungle: { size: 1.0, perCell: 2, minPx: 5 },
  cactus: { size: 0.8, perCell: 0.55, minPx: 6 },
  shrub: { size: 0.6, perCell: 1.2, minPx: 9 },
  grass: { size: 0.5, perCell: 0.8, minPx: 10 },
  dunes: { size: 1.5, perCell: 0.35, minPx: 8 },
  reeds: { size: 0.75, perCell: 1, minPx: 10 },
};

/** The smallest on-screen size (pixels) at which an icon is drawn. */
export const minPixels = (kind: IconKind) => SPEC[kind].minPx;

/**
 * Draws one icon with its ground point at (0, 0), `s` pixels tall, growing upward.
 * Outlines use the "stroke first, fill over" trick: each part is outlined thick, then
 * all parts are filled, so only the outer outline of the whole shape shows.
 */
function drawIcon(ctx: CanvasRenderingContext2D, set: IconKind, variant: number, s: number, style: IconStyle) {
  const r = seededRandom(mixSeed(variant + 1, set.length * 97));
  const j = (amount: number) => 1 + (r() - 0.5) * 2 * amount;
  const [fill, light, line] = style === 'atlas' ? [PAPER, PAPER, INK] : PAINT[set];
  // Outlines thicken with size, but less than in proportion, so big mountains are not drawn in heavy lines.
  const lw = Math.max(1, Math.min(s * 0.06, 0.9 + s * 0.022));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const outlined = (parts: Path2D[]) => {
    ctx.strokeStyle = line;
    ctx.lineWidth = lw * 2;
    for (const p of parts) ctx.stroke(p);
    ctx.fillStyle = fill;
    for (const p of parts) ctx.fill(p);
  };
  const circle = (x: number, y: number, rad: number) => {
    const p = new Path2D();
    p.arc(x, y, rad, 0, Math.PI * 2);
    return p;
  };
  const trunk = (top: number, w: number) => {
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, s * w);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, top);
    ctx.stroke();
  };

  switch (set) {
    case 'mountain':
    case 'volcano': {
      // A peak: a lit left face and a shaded right face, open at the bottom like Nortantis's.
      const pk = (r() - 0.5) * 0.12 * s;
      const top = -0.95 * s * j(0.05);
      const shoulder = (r() - 0.5) * 0.08 * s;
      const crater = set === 'volcano' ? 0.09 * s : 0;
      const outline = new Path2D();
      outline.moveTo(-0.5 * s, 0);
      outline.lineTo(-0.22 * s + shoulder, -0.5 * s);
      outline.lineTo(pk - crater, top);
      if (crater) outline.quadraticCurveTo(pk, top + 0.06 * s, pk + crater, top);
      outline.lineTo(0.24 * s + shoulder, -0.46 * s);
      outline.lineTo(0.5 * s, 0);
      ctx.fillStyle = fill;
      ctx.fill(outline);
      // Shaded face: from the peak down to the right base.
      const face = new Path2D();
      face.moveTo(pk + crater * 0.5, top + (crater ? 0.03 * s : 0));
      face.lineTo(0.24 * s + shoulder, -0.46 * s);
      face.lineTo(0.5 * s, 0);
      face.lineTo(0.06 * s, 0);
      face.closePath();
      if (style === 'atlas') {
        ctx.save();
        ctx.clip(face);
        ctx.strokeStyle = INK;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = Math.max(0.7, Math.min(s * 0.025, 0.6 + s * 0.01));
        for (let k = -6; k < 14; k++) {
          ctx.beginPath();
          ctx.moveTo(k * 0.06 * s, -s);
          ctx.lineTo(k * 0.06 * s + 0.35 * s, 0);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = light;
        ctx.fill(face);
        if (set === 'mountain') {
          // Snow on the peak.
          ctx.fillStyle = '#f6f4ee';
          ctx.beginPath();
          ctx.moveTo(pk, top);
          ctx.lineTo(pk - 0.13 * s, top + 0.24 * s);
          ctx.lineTo(pk - 0.03 * s, top + 0.19 * s);
          ctx.lineTo(pk + 0.04 * s, top + 0.26 * s);
          ctx.lineTo(pk + 0.12 * s, top + 0.21 * s);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = lw;
      ctx.stroke(outline);
      ctx.beginPath();
      ctx.moveTo(pk + crater * 0.5, top + (crater ? 0.03 * s : 0));
      ctx.lineTo(0.06 * s, 0);
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(0.8, lw * 0.7);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (set === 'volcano') {
        // Smoke.
        ctx.strokeStyle = style === 'atlas' ? INK : 'rgba(90, 90, 90, 0.7)';
        ctx.fillStyle = style === 'atlas' ? 'transparent' : 'rgba(150, 150, 150, 0.55)';
        ctx.lineWidth = Math.max(0.8, s * 0.025);
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(pk + (k - 1) * 0.07 * s + k * 0.04 * s, top - (0.12 + k * 0.1) * s, (0.05 + k * 0.015) * s, 0, Math.PI * 2);
          if (style === 'painterly') ctx.fill();
          ctx.stroke();
        }
        if (style === 'painterly') {
          ctx.strokeStyle = '#d0542a';
          ctx.lineWidth = Math.max(1, s * 0.035);
          ctx.beginPath();
          ctx.moveTo(pk, top + 0.04 * s);
          ctx.quadraticCurveTo(pk + 0.05 * s, top + 0.3 * s, pk - 0.02 * s, top + 0.5 * s);
          ctx.stroke();
        }
      }
      break;
    }
    case 'hill': {
      const h = 0.5 * s * j(0.1);
      const mound = new Path2D();
      mound.moveTo(-0.5 * s, 0);
      mound.bezierCurveTo(-0.32 * s, -h * 1.05, 0.3 * s, -h * 1.05, 0.5 * s, 0);
      ctx.fillStyle = fill;
      ctx.fill(mound);
      if (style === 'painterly') {
        ctx.save();
        ctx.clip(mound);
        ctx.fillStyle = light;
        ctx.fillRect(0.05 * s, -s, s, s);
        ctx.restore();
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = lw;
      ctx.stroke(mound);
      ctx.globalAlpha = style === 'atlas' ? 0.6 : 0.4;
      ctx.lineWidth = Math.max(0.7, s * 0.025);
      for (let k = 0; k < 3; k++) {
        const x = (0.12 + k * 0.1) * s;
        ctx.beginPath();
        ctx.moveTo(x, -h * (0.62 - k * 0.15));
        ctx.lineTo(x + 0.04 * s, -h * 0.12);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'plateau': {
      // A mesa: a flat top and steep sides. `s` is the width here.
      const h = 0.3 * s * j(0.1);
      const body = new Path2D();
      body.moveTo(-0.5 * s, 0);
      body.lineTo(-0.36 * s, -h);
      body.lineTo(0.36 * s, -h);
      body.lineTo(0.5 * s, 0);
      ctx.fillStyle = fill;
      ctx.fill(body);
      const side = new Path2D();
      side.moveTo(0.36 * s, -h);
      side.lineTo(0.5 * s, 0);
      side.lineTo(-0.5 * s, 0);
      side.lineTo(-0.44 * s, -h * 0.45);
      side.lineTo(0.38 * s, -h * 0.45);
      side.closePath();
      if (style === 'atlas') {
        ctx.save();
        ctx.clip(side);
        ctx.strokeStyle = INK;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = Math.max(0.7, s * 0.012);
        for (let x = -0.5; x <= 0.5; x += 0.03) {
          ctx.beginPath();
          ctx.moveTo(x * s, -h);
          ctx.lineTo(x * s, 0);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        ctx.fillStyle = light;
        ctx.fill(side);
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.stroke(body);
      break;
    }
    case 'pass': {
      // The map symbol for a pass: two curves facing each other, ")(".
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1.2, s * 0.09);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.28 * s, -0.7 * s);
        ctx.quadraticCurveTo(side * 0.02 * s, -0.35 * s, side * 0.28 * s, 0);
        ctx.stroke();
      }
      break;
    }
    case 'valley': {
      // Drawn centered, along x. Two gentle sides with short ticks down toward the floor.
      if (style === 'painterly') {
        ctx.fillStyle = 'rgba(70, 105, 55, 0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.5 * s, 0.14 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1, s * 0.022);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-0.5 * s, side * 0.03 * s);
        ctx.quadraticCurveTo(0, side * 0.3 * s, 0.5 * s, side * 0.03 * s);
        ctx.stroke();
        ctx.globalAlpha = 0.6;
        for (let k = -3; k <= 3; k++) {
          const x = k * 0.11 * s;
          const y = side * (0.15 - Math.abs(k) * 0.012) * s;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y - side * 0.06 * s);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'canyon': {
      // Drawn centered, along x: two jagged rims, hachures running down the walls, and the floor between them.
      const half = (k: number) => (0.06 + r() * 0.03) * s * (1 - 0.75 * ((k - 6) / 6) ** 2);
      const top: [number, number][] = [];
      const bottom: [number, number][] = [];
      for (let k = 0; k <= 12; k++) {
        const x = (-0.5 + k / 12) * s;
        top.push([x, -half(k)]);
        bottom.push([x, half(k)]);
      }
      const gorge = new Path2D();
      gorge.moveTo(top[0][0], top[0][1]);
      for (const [x, y] of top) gorge.lineTo(x, y);
      for (const [x, y] of [...bottom].reverse()) gorge.lineTo(x, y);
      gorge.closePath();
      ctx.fillStyle = style === 'atlas' ? 'rgba(59, 47, 34, 0.16)' : fill;
      ctx.fill(gorge);
      // Hachures from each rim toward the floor.
      ctx.save();
      ctx.clip(gorge);
      ctx.strokeStyle = style === 'atlas' ? INK : light;
      ctx.globalAlpha = style === 'atlas' ? 0.6 : 0.9;
      ctx.lineWidth = Math.max(0.7, Math.min(s * 0.014, 0.6 + s * 0.006));
      for (const rim of [top, bottom])
        for (let k = 0; k < rim.length - 1; k++)
          for (const t of [0.2, 0.6]) {
            const x = rim[k][0] + (rim[k + 1][0] - rim[k][0]) * t;
            const y = rim[k][1] + (rim[k + 1][1] - rim[k][1]) * t;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.008 * s, y * 0.35);
            ctx.stroke();
          }
      ctx.restore();
      // The floor.
      ctx.strokeStyle = line;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(0.7, Math.min(s * 0.012, 0.6 + s * 0.005));
      ctx.beginPath();
      for (let k = 1; k <= 11; k++) {
        const x = (-0.5 + k / 12) * s;
        const y = (r() - 0.5) * 0.02 * s;
        if (k === 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // The rims.
      ctx.lineWidth = Math.max(1, Math.min(s * 0.022, 0.8 + s * 0.01));
      for (const w of [top, bottom]) {
        ctx.beginPath();
        w.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      break;
    }
    case 'cliff': {
      // Drawn centered, along x: a jagged edge with short hachures down its lower side.
      const pts: [number, number][] = [];
      for (let k = 0; k <= 12; k++) pts.push([(-0.5 + k / 12) * s, (r() - 0.5) * 0.04 * s]);
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1.2, s * 0.03);
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, s * 0.016);
      for (let k = 0; k < pts.length - 1; k++)
        for (const t of [0.25, 0.75]) {
          const x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t;
          const y = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.01 * s, y + (0.07 + r() * 0.04) * s);
          ctx.stroke();
        }
      break;
    }
    case 'deciduous': {
      trunk(-0.3 * s, 0.08);
      const h = 0.62 * j(0.06);
      const parts = [circle(0, -h * s, 0.27 * s * j(0.08)), circle(-0.17 * s, -0.47 * s, 0.2 * s * j(0.1)), circle(0.17 * s, -0.47 * s, 0.2 * s * j(0.1))];
      outlined(parts);
      // A little shading on the lower right.
      ctx.strokeStyle = style === 'atlas' ? INK : line;
      ctx.globalAlpha = style === 'atlas' ? 0.55 : 0.4;
      ctx.lineWidth = Math.max(0.8, lw * 0.8);
      ctx.beginPath();
      ctx.arc(0.04 * s, -0.5 * s, 0.22 * s, 0.15 * Math.PI, 0.55 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (style === 'painterly') {
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(-0.07 * s, -0.68 * s, 0.1 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'pine': {
      trunk(-0.18 * s, 0.07);
      const w = j(0.08);
      const tier = (apex: number, base: number, half: number) => {
        const p = new Path2D();
        p.moveTo(0, apex * s);
        p.lineTo(half * w * s, base * s);
        p.lineTo(-half * w * s, base * s);
        p.closePath();
        return p;
      };
      outlined([tier(-0.72, -0.18, 0.27), tier(-0.88, -0.4, 0.21), tier(-1, -0.62, 0.15)]);
      if (style === 'painterly') {
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(0, -0.95 * s);
        ctx.lineTo(-0.1 * s, -0.66 * s);
        ctx.lineTo(0, -0.66 * s);
        ctx.fill();
      }
      break;
    }
    case 'jungle': {
      // A palm: a curved trunk and drooping fronds.
      const lean = (r() - 0.5) * 0.16 * s;
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(lean * 0.2, -0.35 * s, lean, -0.62 * s);
      ctx.stroke();
      const fronds: Path2D[] = [];
      for (let k = 0; k < 5; k++) {
        const a = Math.PI * (0.08 + (k / 4) * 0.84) + (r() - 0.5) * 0.15;
        const dx = -Math.cos(a) * 0.42 * s;
        const p = new Path2D();
        p.moveTo(lean, -0.62 * s);
        p.quadraticCurveTo(lean + dx * 0.6, -0.86 * s, lean + dx, -0.5 * s + Math.abs(dx) * 0.2);
        p.quadraticCurveTo(lean + dx * 0.55, -0.7 * s, lean, -0.62 * s);
        fronds.push(p);
      }
      outlined(fronds);
      break;
    }
    case 'cactus': {
      const part = (x: number, top: number, bottom: number, w: number) => {
        const p = new Path2D();
        p.roundRect(x - w / 2, top, w, bottom - top, w / 2);
        return p;
      };
      const arm = j(0.12);
      outlined([
        part(0, -0.9 * s, 0, 0.2 * s),
        part(-0.2 * s, -0.62 * s * arm, -0.3 * s, 0.13 * s),
        part(0.2 * s, -0.7 * s / arm, -0.38 * s, 0.13 * s),
        part(-0.13 * s, -0.36 * s, -0.27 * s, 0.2 * s),
        part(0.13 * s, -0.44 * s, -0.35 * s, 0.2 * s),
      ]);
      break;
    }
    case 'shrub': {
      outlined([circle(-0.22 * s, -0.25 * s, 0.24 * s * j(0.1)), circle(0.2 * s, -0.24 * s, 0.22 * s * j(0.1)), circle(0, -0.4 * s, 0.28 * s * j(0.1))]);
      break;
    }
    case 'grass': {
      ctx.strokeStyle = style === 'atlas' ? INK : fill;
      ctx.lineWidth = Math.max(1, s * 0.09);
      const n = 4 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const x = ((k / (n - 1)) - 0.5) * 0.6 * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x * 1.1, -0.5 * s, x * 1.6 + (r() - 0.5) * 0.15 * s, -(0.7 + r() * 0.3) * s);
        ctx.stroke();
      }
      break;
    }
    case 'dunes': {
      // A crescent ridge with shading strokes on the lee side. `s` is the width here.
      const h = 0.32 * s * j(0.15);
      const ridge = new Path2D();
      ridge.moveTo(-0.5 * s, 0);
      ridge.quadraticCurveTo(-0.15 * s, -h * 1.6, 0.08 * s, -h);
      ridge.quadraticCurveTo(0.28 * s, -h * 0.5, 0.5 * s, 0);
      if (style === 'painterly') {
        ctx.fillStyle = light;
        ctx.fill(ridge);
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.stroke(ridge);
      ctx.globalAlpha = style === 'atlas' ? 0.6 : 0.5;
      ctx.lineWidth = Math.max(0.8, s * 0.022);
      for (let k = 1; k <= 3; k++) {
        const x = 0.08 * s + k * 0.09 * s;
        ctx.beginPath();
        ctx.moveTo(x, -h * (1 - k * 0.22));
        ctx.lineTo(x - 0.05 * s, -h * (0.55 - k * 0.15));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'reeds': {
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1, s * 0.06);
      for (let k = -1; k <= 1; k++) {
        const x = k * 0.16 * s;
        const top = -(0.75 + r() * 0.25) * s;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + k * 0.04 * s, top * 0.5, x + k * 0.08 * s, top);
        ctx.stroke();
        ctx.fillStyle = style === 'atlas' ? INK : '#6b4b2e';
        ctx.beginPath();
        ctx.ellipse(x + k * 0.07 * s, top + 0.12 * s, 0.045 * s, 0.11 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(-0.4 * s, 0.02 * s);
      ctx.lineTo(0.4 * s, 0.02 * s);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
  }
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Where the icon's ground point is in the sprite, in pixels. */
  ax: number;
  ay: number;
}

const sprites = new Map<string, Sprite>();

/** The picture of one icon at `px` pixels (made once per size, then reused). */
export function sprite(set: IconKind, variant: number, px: number, style: IconStyle): Sprite {
  const key = `${style}|${set}|${variant}|${px}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (sprites.size > 800) sprites.clear();
  const centered = ROTATABLE.has(set);
  // A volcano's smoke rises above its peak.
  const w = Math.ceil(px * 1.3) + 4;
  const h = Math.ceil(px * (centered ? 1.3 : set === 'volcano' ? 1.6 : 1.25)) + 4;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const ax = w / 2;
  const ay = centered ? h / 2 : h - Math.ceil(px * 0.12) - 2;
  ctx.translate(ax, ay);
  drawIcon(ctx, set, variant, px, style);
  const s = { canvas, ax, ay };
  sprites.set(key, s);
  return s;
}

export interface Placement {
  /** Ground point, in map units (the middle, for icons with a direction). */
  x: number;
  y: number;
  /** Size in map units. */
  size: number;
  set: IconKind;
  variant: number;
  /** Direction in degrees, for cliffs, canyons and valleys. */
  angle?: number;
  /** Set for icons placed by hand: the placed icon's ID. */
  placed?: string;
}

/**
 * Where the biome icons go: a few per land cell, jittered around the cell's center, the
 * same every time (seeded by the map's seed and the cell). Cells on the coast get one
 * smaller icon at their center, so icons stay off the water. Sorted top to bottom, so
 * nearer icons overlap farther ones.
 */
export function placeIcons(g: Graph, land: Uint8Array, biome: Uint8Array, looks: (SlotLook | null)[], seed: number, noPlants?: Uint8Array): Placement[] {
  const out: Placement[] = [];
  for (let c = 0; c < g.cellCount; c++) {
    if (!land[c] || !biome[c] || noPlants?.[c]) continue;
    const look = looks[biome[c]];
    if (!look || look.icons === 'none') continue;
    const set = look.icons;
    const spec = SPEC[set];
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
      if (set === 'dunes') continue;
      out.push({ x: cx, y: cy, size: spec.size * g.spacing * 0.7, set, variant: Math.floor(rand() * VARIANTS) });
      continue;
    }
    let n = Math.floor(spec.perCell);
    if (rand() < spec.perCell - n) n++;
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * g.spacing * 0.38;
      out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, size: spec.size * g.spacing * (0.85 + rand() * 0.3), set, variant: Math.floor(rand() * VARIANTS) });
    }
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}
