import { LINE, chaikin, clearShape, ink, lerp, minLineWidth, pathOf, rng, type ArtColors, type Pt, type Rng } from './ink';

// Plants and ground icons in the style of the FA01-Temperate pack (our own drawing code; the
// pack was only a style reference): bold dark outlines, flat see-through shading in two tones
// on the shadow side, inner lines marking lumps, small texture marks, grass tufts at the base.
// Their lines are set from their own size, so small plants stay delicate.

/** Each kind's width relative to a mountain's, as it was drawn when its line weights were set. */
const REL = { deciduous: 0.4, pine: 0.44, jungle: 0.42, cactus: 0.35, shrub: 0.27, grass: 0.24, dunes: 0.62, reeds: 0.31 };
const PLANT_LINE = 0.85;

/** Outline of a union of circles: stroke them all thick, then clear their insides (the outer half of the stroke stays). */
function blobOutline(ctx: CanvasRenderingContext2D, circles: [number, number, number][], width: number, c: ArtColors) {
  const path = new Path2D();
  for (const [x, y, rad] of circles) {
    path.moveTo(x + rad, y);
    path.arc(x, y, rad, 0, Math.PI * 2);
  }
  ctx.save();
  ctx.strokeStyle = c.color;
  ctx.lineWidth = Math.max(width, minLineWidth()) * 2;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
  clearShape(ctx, path, c.fill);
}

/** Flat shading inside a shape: the shape minus itself shifted toward the light (up and left), so a crescent on the lower right. */
function crescent(ctx: CanvasRenderingContext2D, shapeFn: () => Path2D, dx: number, dy: number, color: string) {
  const layer = document.createElement('canvas');
  layer.width = ctx.canvas.width;
  layer.height = ctx.canvas.height;
  const g = layer.getContext('2d')!;
  g.setTransform(ctx.getTransform());
  g.fillStyle = color;
  g.fill(shapeFn());
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.translate(dx, dy);
  g.fill(shapeFn());
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/** A small grass tuft: a few blades fanning up from (x, y). */
function tuft(ctx: CanvasRenderingContext2D, r: Rng, x: number, y: number, size: number, U: number) {
  const n = 3 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k / (n - 1) - 0.5) * 1.3 + (r() - 0.5) * 0.2;
    const len = size * (0.6 + r() * 0.5) * (1 - Math.abs(k / (n - 1) - 0.5) * 0.6);
    const bend = (r() - 0.5) * size * 0.3;
    const pts: Pt[] = [
      [x, y],
      [x + Math.cos(a) * len * 0.5 + bend * 0.3, y + Math.sin(a) * len * 0.5],
      [x + Math.cos(a) * len + bend, y + Math.sin(a) * len],
    ];
    ink(ctx, chaikin(pts, 1), U * LINE.lit * 1.1, r, { taperStart: 0.05, taperEnd: 0.7, minFrac: 0.2 });
  }
}

/** A leafy tree: a lumpy crown on a trunk, shaded on the lower right, with tufts at its foot. Drawn W wide, H about 1.15 W. */
export function deciduous(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.deciduous;
  const lw = U * LINE.outline * PLANT_LINE;
  ctx.strokeStyle = c.color;
  const base = H * 0.96;
  const tall = r() < 0.35;
  const cx = W * (0.48 + r() * 0.04);
  const crownR = W * (tall ? 0.3 : 0.36 + r() * 0.06);
  const crownCy = tall ? H * 0.36 : H * (0.36 + r() * 0.06);
  const trunkTop = crownCy + crownR * 0.6;
  // The trunk first (the crown overlaps it).
  const tw = W * (tall ? 0.045 : 0.07 + r() * 0.03);
  const lean = (r() - 0.5) * W * 0.04;
  const trunkL = chaikin([[cx - tw * 0.8 + lean, trunkTop], [cx - tw + lean * 0.5, lerp(trunkTop, base, 0.6)], [cx - tw * 1.8, base]], 2);
  const trunkR = chaikin([[cx + tw * 0.8 + lean, trunkTop], [cx + tw + lean * 0.5, lerp(trunkTop, base, 0.6)], [cx + tw * 1.9, base]], 2);
  const trunk = pathOf([...trunkL, ...[...trunkR].reverse()], true);
  clearShape(ctx, trunk, c.fill);
  ctx.save();
  ctx.clip(trunk);
  ctx.fillStyle = c.wash;
  ctx.fillRect(cx + lean * 0.5, trunkTop, W, base - trunkTop);
  ctx.restore();
  ink(ctx, trunkL, lw * 0.8, r, { taperStart: 0.05, taperEnd: 0.1 });
  ink(ctx, trunkR, lw * 0.8, r, { taperStart: 0.05, taperEnd: 0.1 });
  // The crown: a dome of overlapping lumps.
  const circles: [number, number, number][] = [];
  const n = 6 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const a = Math.PI + (k / (n - 1)) * Math.PI + (r() - 0.5) * 0.3;
    const d = crownR * (0.55 + r() * 0.15);
    circles.push([cx + Math.cos(a) * d * (tall ? 0.8 : 1.05), crownCy + Math.sin(a) * d * (tall ? 1.25 : 0.85) + crownR * 0.15, crownR * (0.42 + r() * 0.16)]);
  }
  circles.push([cx, crownCy + crownR * 0.1, crownR * 0.62]);
  for (let k = 0; k < 3; k++) circles.push([cx + (k - 1) * crownR * 0.55, crownCy + crownR * 0.45, crownR * (0.38 + r() * 0.1)]);
  const crownPath = () => {
    const p = new Path2D();
    for (const [x, y, rad] of circles) {
      p.moveTo(x + rad, y);
      p.arc(x, y, rad, 0, Math.PI * 2);
    }
    return p;
  };
  blobOutline(ctx, circles, lw, c);
  ctx.save();
  ctx.clip(crownPath());
  crescent(ctx, crownPath, -crownR * 0.25, -crownR * 0.3, c.wash);
  crescent(ctx, crownPath, -crownR * 0.12, -crownR * 0.18, c.washDark);
  // Lumps: arcs along the lower edges of a few inner lumps.
  let arcs = 0;
  for (const [x, y, rad] of circles.slice(0, -3)) {
    if (r() < 0.55 || arcs >= 3) continue;
    arcs++;
    const a0 = 0.02 * Math.PI + r() * 0.15;
    const pts: Pt[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (k / 8) * (0.4 * Math.PI);
      pts.push([x + Math.cos(a) * rad * 0.92, y + Math.sin(a) * rad * 0.92]);
    }
    ink(ctx, pts, lw * 0.75, r, { taperStart: 0.3, taperEnd: 0.3 });
  }
  // Texture: small dashes.
  for (let k = 0, m = 4 + Math.floor(r() * 6); k < m; k++) {
    const x = cx + (r() - 0.3) * crownR * 1.5;
    const y = crownCy + (r() - 0.2) * crownR * 1.1;
    const a = (r() - 0.5) * 1.2;
    const len = crownR * (0.06 + r() * 0.08);
    ink(ctx, [[x, y], [x + Math.cos(a) * len, y + Math.sin(a) * len]], lw * 0.6, r, { taperStart: 0.2, taperEnd: 0.2 });
  }
  ctx.restore();
  for (let k = 0, m = 1 + Math.floor(r() * 3); k < m; k++) tuft(ctx, r, cx + (r() - 0.5) * W * 0.7, base, W * 0.07, U);
}

/** A fir: stacked tiers with scalloped edges, shaded on the right and under each tier; sometimes two. Drawn W wide, H about 1.5 W. */
export function pine(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.pine;
  const lw = U * LINE.outline * PLANT_LINE;
  const one = (cx: number, top: number, bottom: number, hw: number) => {
    ctx.strokeStyle = c.color;
    const tiers = 4 + Math.floor(r() * 3);
    const trunkH = (bottom - top) * 0.08;
    const ground = bottom;
    bottom -= trunkH;
    const trunk = pathOf([[cx - hw * 0.12, bottom - trunkH], [cx + hw * 0.12, bottom - trunkH], [cx + hw * 0.14, ground], [cx - hw * 0.14, ground]], true);
    clearShape(ctx, trunk, c.fill);
    ink(ctx, [[cx - hw * 0.12, bottom], [cx - hw * 0.14, ground]], lw * 0.8, r);
    ink(ctx, [[cx + hw * 0.12, bottom], [cx + hw * 0.14, ground]], lw * 0.8, r);
    // Tier edges: each tier's bottom is a scalloped line, wider lower down.
    const edges: Pt[][] = [];
    for (let t = 1; t <= tiers; t++) {
      const y = lerp(top, bottom, t / tiers);
      const w = hw * Math.pow(t / tiers, 0.9) * (0.92 + r() * 0.12);
      const pts: Pt[] = [];
      const scal = 3 + Math.floor(w / (hw * 0.25));
      for (let k = 0; k <= scal * 4; k++) {
        const u = k / (scal * 4);
        const bump = Math.abs(Math.sin(u * scal * Math.PI));
        pts.push([cx - w + 2 * w * u, y - bump * (bottom - top) * 0.025 - (1 - Math.abs(u - 0.5) * 2) * (bottom - top) * 0.02]);
      }
      edges.push(pts);
    }
    // Silhouette: from the tip down the left side (tier corners), along the last edge, up the right side.
    const left: Pt[] = [[cx, top]];
    const right: Pt[] = [[cx, top]];
    edges.forEach((e, i) => {
      const prevY = i === 0 ? top : lerp(top, bottom, i / tiers);
      const inset = i === 0 ? 0 : (e[0][0] - cx) * 0.45;
      if (i > 0) {
        left.push([cx + inset, prevY + (bottom - top) * 0.012]);
        right.push([cx - inset, prevY + (bottom - top) * 0.012]);
      }
      left.push(e[0]);
      right.push(e[e.length - 1]);
    });
    const last = edges[edges.length - 1];
    const sil = [...left, ...last.slice(1, -1), ...[...right].reverse()];
    const body = pathOf(sil, true);
    clearShape(ctx, body, c.fill);
    ctx.save();
    ctx.clip(body);
    // Shading: the right half, and a darker band under each tier edge.
    ctx.fillStyle = c.wash;
    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.05, top);
    ctx.lineTo(cx + hw * 1.2, bottom);
    ctx.lineTo(cx - hw * 0.05, bottom);
    ctx.closePath();
    ctx.fill();
    for (const e of edges.slice(0, -1)) {
      const p = new Path2D();
      p.moveTo(e[0][0], e[0][1]);
      for (const q of e) p.lineTo(q[0], q[1]);
      for (const q of [...e].reverse()) p.lineTo(q[0], q[1] - (bottom - top) * 0.05);
      ctx.fillStyle = c.washDark;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - hw * 0.2, 0, hw * 2, H);
      ctx.clip();
      ctx.fill(p);
      ctx.restore();
    }
    for (const e of edges.slice(0, -1)) ink(ctx, e.slice(1, -1), lw * 0.75, r, { taperStart: 0.15, taperEnd: 0.15 });
    ctx.restore();
    ink(ctx, [...sil, sil[0]], lw, r, { taperStart: 0.02, taperEnd: 0.02, minFrac: 0.6 });
  };
  const base = H * 0.97;
  if (r() < 0.3) {
    const side = r() < 0.5 ? -1 : 1;
    one(W * (0.5 + side * 0.17), H * 0.04, base, W * 0.3);
    one(W * (0.5 - side * 0.16), H * 0.3, base, W * 0.24);
  } else one(W * 0.5, H * (0.02 + r() * 0.06), base, W * (0.36 + r() * 0.06));
  for (let k = 0, m = Math.floor(r() * 3); k < m; k++) tuft(ctx, r, W * (0.15 + r() * 0.7), base, W * 0.07, U);
}

/** A palm: a curved, ringed trunk and four to six long fronds that rise and arch over. Drawn W wide, H about 1.15 W. */
export function palm(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.jungle;
  const lw = U * LINE.outline * PLANT_LINE;
  ctx.strokeStyle = c.color;
  const base = H * 0.97;
  const lean = (r() - 0.5) * W * 0.3;
  const topX = W * 0.5 + lean;
  const topY = H * 0.24;
  const curve = (t: number): Pt => [lerp(W * 0.5 - lean * 0.2, topX, t) + Math.sin(t * Math.PI) * lean * 0.3, lerp(base, topY, t)];
  const tw = W * 0.038;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const [x, y] = curve(t);
    const w = tw * (1.2 - 0.45 * t);
    left.push([x - w, y]);
    right.push([x + w, y]);
  }
  const trunk = pathOf([...left, ...[...right].reverse()], true);
  clearShape(ctx, trunk, c.fill);
  ctx.save();
  ctx.clip(trunk);
  ctx.fillStyle = c.wash;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  for (let k = 1; k < 12; k++) {
    const [x, y] = curve(k / 12);
    const w = tw * (1.2 - 0.45 * (k / 12));
    ink(ctx, [[x - w * 0.9, y - w * 0.1], [x, y + w * 0.25], [x + w * 0.9, y - w * 0.1]], lw * 0.5, r, { taperStart: 0.2, taperEnd: 0.2 });
  }
  ink(ctx, left, lw * 0.8, r, { taperStart: 0.05, taperEnd: 0.1 });
  ink(ctx, right, lw * 0.8, r, { taperStart: 0.05, taperEnd: 0.1 });
  // Fronds: long, narrow leaves with gaps between them, so the crown still reads as a palm when small.
  // Upper fronds rise before arching over; lower ones start level and droop.
  const fronds: { a: number; len: number; back: boolean }[] = [];
  const n = 4 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const side = k % 2 ? -1 : 1;
    const rank = Math.floor(k / 2);
    const lift = [-0.75, -0.2, 0.25][rank] + (r() - 0.5) * 0.2;
    fronds.push({ a: side > 0 ? lift : Math.PI - lift, len: W * (0.44 + r() * 0.12) * (rank === 0 ? 1 : 0.9), back: rank === 0 });
  }
  fronds.sort((p, q) => (p.back === q.back ? 0 : p.back ? -1 : 1));
  for (const f of fronds) {
    const rib: Pt[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      rib.push([topX + Math.cos(f.a) * f.len * t, topY + Math.sin(f.a) * f.len * t * 0.7 + t * t * f.len * 0.85]);
    }
    const side1: Pt[] = [];
    const side2: Pt[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const [x, y] = rib[k];
      const [x2, y2] = rib[Math.min(10, k + 1)];
      const dx = x2 - x || 1e-3;
      const dy = y2 - y;
      const l = Math.hypot(dx, dy);
      const w = f.len * 0.1 * Math.sin(Math.min(1, t * 1.05) * Math.PI) * (k % 2 ? 0.8 : 1);
      side1.push([x - (dy / l) * w, y + (dx / l) * w]);
      side2.push([x + (dy / l) * w, y - (dx / l) * w]);
    }
    const leaf = pathOf([...side1, ...[...side2].reverse()], true);
    clearShape(ctx, leaf, c.fill);
    ctx.save();
    ctx.clip(leaf);
    ctx.fillStyle = f.back ? c.washDark : c.wash;
    ctx.fill(pathOf([...rib, ...[...side1].reverse()], true));
    ctx.restore();
    ink(ctx, [...side1, ...[...side2].reverse(), side1[0]], lw * 0.75, r, { taperStart: 0.02, taperEnd: 0.02, minFrac: 0.6 });
  }
  // Coconuts.
  ctx.fillStyle = c.color;
  for (let k = 0, m = 2 + Math.floor(r() * 2); k < m; k++) {
    ctx.beginPath();
    ctx.arc(topX + (k - 1) * W * 0.028, topY + W * 0.025, W * 0.017, 0, Math.PI * 2);
    ctx.fill();
  }
  tuft(ctx, r, W * 0.5 - lean * 0.2 + (r() < 0.5 ? -1 : 1) * W * 0.12, base, W * 0.08, U);
}

/** A saguaro cactus: a column with a rounded top and one or two upturned arms, ribbed and shaded on the right. Drawn W wide, H about 1.3 W. */
export function cactus(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.cactus;
  const lw = U * LINE.outline * PLANT_LINE;
  ctx.strokeStyle = c.color;
  const base = H * 0.96;
  const cx = W * 0.5;
  const cw = W * 0.1;
  const top = H * (0.06 + r() * 0.08);
  const column = (x: number, y0: number, y1: number, w: number) => {
    const p = new Path2D();
    p.moveTo(x - w, y1);
    p.lineTo(x - w, y0 + w);
    p.arc(x, y0 + w, w, Math.PI, 0);
    p.lineTo(x + w, y1);
    p.closePath();
    return p;
  };
  const bar = (x0: number, x1: number, y: number, w: number) => {
    const p = new Path2D();
    const a = Math.min(x0, x1);
    const b = Math.max(x0, x1);
    p.moveTo(a, y - w);
    p.lineTo(b, y - w);
    p.arc(b, y, w, -Math.PI / 2, Math.PI / 2);
    p.lineTo(a, y + w);
    p.closePath();
    return p;
  };
  const shapes: Path2D[] = [];
  const arms = r() < 0.25 ? 1 : 2;
  for (let k = 0; k < arms; k++) {
    const side = arms === 1 ? (r() < 0.5 ? -1 : 1) : k ? -1 : 1;
    const at = lerp(top, base, 0.42 + r() * 0.22);
    const out = W * (0.2 + r() * 0.06);
    const up = (base - top) * (0.2 + r() * 0.15);
    const aw = cw * 0.72;
    shapes.push(bar(cx, cx + side * out, at, aw));
    shapes.push(column(cx + side * out, at - up, at, aw));
  }
  shapes.push(column(cx, top, base, cw));
  const all = new Path2D();
  for (const s of shapes) all.addPath(s);
  ctx.save();
  ctx.lineWidth = Math.max(lw, minLineWidth()) * 2;
  ctx.lineJoin = 'round';
  ctx.stroke(all);
  ctx.restore();
  clearShape(ctx, all, c.fill);
  ctx.save();
  ctx.clip(all);
  ctx.fillStyle = c.wash;
  ctx.fillRect(cx + cw * 0.25, 0, W, H);
  for (const dx of [-0.45, 0, 0.45]) ink(ctx, [[cx + cw * dx, top + cw * 0.6], [cx + cw * dx, base]], lw * 0.45, r, { taperStart: 0.1, taperEnd: 0.05 });
  ctx.restore();
  // Spines: short ticks along the edges.
  for (let y = top + cw; y < base - cw * 0.5; y += cw * (0.7 + r() * 0.4)) {
    ink(ctx, [[cx - cw * 1.05, y], [cx - cw * 1.3, y - cw * 0.1]], lw * 0.4, r);
    ink(ctx, [[cx + cw * 1.05, y], [cx + cw * 1.3, y - cw * 0.1]], lw * 0.4, r);
  }
  tuft(ctx, r, cx + (r() < 0.5 ? -1 : 1) * W * (0.2 + r() * 0.1), base, W * 0.08, U);
}

/** A shrub: a fan of pointed leaves from the ground, some shaded. Drawn W wide, H about 0.7 W. */
export function shrub(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.shrub;
  const lw = U * LINE.outline * PLANT_LINE * 0.75;
  ctx.strokeStyle = c.color;
  const base = H * 0.95;
  const leaves: { a: number; len: number; sx: number; w: number; shade: boolean; depth: number }[] = [];
  for (let k = 0, n = 9 + Math.floor(r() * 6); k < n; k++) {
    const t = r();
    const len = H * (0.45 + r() * 0.4) * (1 - Math.abs(t - 0.5) * 0.7);
    leaves.push({ a: -Math.PI / 2 + (t - 0.5) * 2.2, len, sx: W * 0.5 + (t - 0.5) * W * 0.5, w: len * (0.22 + r() * 0.1), shade: r() < 0.4, depth: r() });
  }
  leaves.sort((p, q) => p.depth - q.depth);
  for (const l of leaves) {
    const tipX = l.sx + Math.cos(l.a) * l.len;
    const tipY = base + Math.sin(l.a) * l.len;
    const nx = -Math.sin(l.a);
    const ny = Math.cos(l.a);
    const mx = (l.sx + tipX) / 2;
    const my = (base + tipY) / 2;
    const leaf = new Path2D();
    leaf.moveTo(l.sx, base);
    leaf.quadraticCurveTo(mx + nx * l.w, my + ny * l.w, tipX, tipY);
    leaf.quadraticCurveTo(mx - nx * l.w, my - ny * l.w, l.sx, base);
    clearShape(ctx, leaf, c.fill);
    if (l.shade) {
      ctx.fillStyle = l.depth < 0.4 ? c.washDark : c.wash;
      ctx.fill(leaf);
    }
    ctx.lineWidth = Math.max(lw, minLineWidth());
    ctx.lineJoin = 'round';
    ctx.stroke(leaf);
  }
  for (let k = 0; k < 3; k++) ink(ctx, [[W * (0.1 + r() * 0.2) + k * W * 0.3, base + H * 0.02], [W * (0.18 + r() * 0.2) + k * W * 0.3, base + H * 0.02]], lw * 0.7, r);
}

/** Grass: one to three small tufts. Drawn W wide, H about 0.6 W. */
export function grass(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.grass;
  ctx.strokeStyle = c.color;
  const n = 1 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const big = k === 0;
    tuft(ctx, r, W * (n === 1 ? 0.5 : 0.2 + (0.6 * k) / Math.max(1, n - 1) + (r() - 0.5) * 0.1), H * 0.95, H * (big ? 0.75 : 0.45 + r() * 0.2), U * 1.1);
  }
}

/** Dunes: one or two smooth crests, the slip face on the right shaded, with a ripple or two. Drawn W wide, H about 0.45 W. */
export function dunes(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors) {
  const r = rng(seed);
  const U = W / REL.dunes;
  const lw = U * LINE.outline * PLANT_LINE * 0.8;
  ctx.strokeStyle = c.color;
  const base = H * 0.95;
  const one = (x0: number, x1: number, peakX: number, top: number) => {
    const crestL = chaikin([[x0, base], [lerp(x0, peakX, 0.55), lerp(base, top, 0.7)], [peakX, top]], 3);
    const crestR = chaikin([[peakX, top], [lerp(peakX, x1, 0.3), lerp(top, base, 0.55)], [x1, base]], 3);
    const body = pathOf([...crestL, ...crestR.slice(1)], true);
    clearShape(ctx, body, c.fill);
    const slip = pathOf([[peakX, top], ...crestR.slice(1), [peakX + (x1 - peakX) * 0.15, base]], true);
    ctx.fillStyle = c.wash;
    ctx.fill(slip);
    ctx.save();
    ctx.clip(slip);
    ctx.fillStyle = c.washDark;
    ctx.fill(pathOf([[peakX, top], [peakX + (x1 - peakX) * 0.35, lerp(top, base, 0.5)], [peakX + (x1 - peakX) * 0.15, base], [peakX - 1, base]], true));
    ctx.restore();
    ink(ctx, [...crestL, ...crestR.slice(1)], lw, r, { taperStart: 0.2, taperEnd: 0.2 });
    for (let k = 0, m = 1 + Math.floor(r() * 2); k < m; k++) {
      const t = 0.35 + k * 0.25 + r() * 0.1;
      const y = lerp(base, top, t * 0.8);
      const xa = lerp(x0, peakX, t * 0.7 + 0.15);
      ink(ctx, chaikin([[xa - W * 0.08, y + H * 0.04], [xa, y], [xa + W * 0.06, y + H * 0.02]], 2), lw * 0.5, r, { taperStart: 0.3, taperEnd: 0.3 });
    }
  };
  if (r() < 0.45) {
    one(W * 0.0, W * 0.62, W * (0.32 + r() * 0.06), H * (0.35 + r() * 0.15));
    one(W * 0.32, W * 1.0, W * (0.7 + r() * 0.06), H * (0.15 + r() * 0.15));
  } else one(W * 0.02, W * 0.98, W * (0.5 + r() * 0.12), H * (0.12 + r() * 0.2));
}

/** Reeds: tall blades and a few cattails standing in shallow water. Drawn W wide, H about W. */
export function reeds(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors, water: string) {
  const r = rng(seed);
  const U = W / REL.reeds;
  const lw = U * LINE.outline * PLANT_LINE;
  ctx.strokeStyle = c.color;
  const base = H * 0.86;
  // Water: soft strokes under the reeds.
  for (let k = 0; k < 3; k++) {
    const y = base + H * (0.03 + k * 0.045);
    const x0 = W * (0.05 + r() * 0.15 + k * 0.05);
    const x1 = W * (0.95 - r() * 0.15 - k * 0.05);
    ctx.save();
    ctx.strokeStyle = water;
    ink(ctx, chaikin([[x0, y], [lerp(x0, x1, 0.5), y + H * 0.01], [x1, y]], 2), lw * 1.6, r, { taperStart: 0.3, taperEnd: 0.3 });
    ctx.restore();
  }
  for (let k = 0, n = 9 + Math.floor(r() * 6); k < n; k++) {
    const x = W * (0.25 + r() * 0.5);
    const a = -Math.PI / 2 + (r() - 0.5) * 0.9;
    const len = H * (0.35 + r() * 0.45);
    const bend = (r() - 0.5) * W * 0.12;
    ink(ctx, chaikin([[x, base], [x + Math.cos(a) * len * 0.5, base + Math.sin(a) * len * 0.5], [x + Math.cos(a) * len + bend, base + Math.sin(a) * len]], 2), lw * 0.45, r, { taperStart: 0.05, taperEnd: 0.8, minFrac: 0.2 });
  }
  // Cattails.
  ctx.fillStyle = c.color;
  for (let k = 0, m = 2 + Math.floor(r() * 3); k < m; k++) {
    const x = W * (0.32 + r() * 0.36);
    const top = H * (0.04 + r() * 0.2);
    const sway = (r() - 0.5) * W * 0.08;
    ink(ctx, chaikin([[x, base], [x + sway * 0.4, lerp(base, top, 0.5)], [x + sway, top]], 2), lw * 0.4, r, { taperStart: 0.05, taperEnd: 0.05 });
    ctx.beginPath();
    ctx.ellipse(x + sway * 0.95, lerp(top, base, 0.08 + r() * 0.05), W * 0.022, H * 0.07, sway * 0.004, 0, Math.PI * 2);
    ctx.fill();
  }
  tuft(ctx, r, W * (0.12 + r() * 0.08), base, H * 0.18, U);
  tuft(ctx, r, W * (0.82 + r() * 0.08), base, H * 0.14, U);
}
