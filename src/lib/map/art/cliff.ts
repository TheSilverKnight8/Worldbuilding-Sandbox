import type { CliffShape } from '../../world/types';
import { LINE, chaikin, clearShape, displace, ink, lerp, pathOf, rng, wobble, yAt, type ArtColors, type Pt, type Rng } from './ink';

// Cliffs, drawn along x (the map turns them to their direction). One side only: the high
// ground is on one side of the rim, the drop on the other. The ends are left open (no inked
// sides), so cliffs placed end to end run into each other.
//
// cliffFacing(): the drop faces the viewer (down the image), so its rock face shows: a tall
//   hatched face hanging from the rim, fading into the low ground, with loose rock at its foot.
// cliffAway(): the drop faces away from the viewer (up the image), so the face is hidden:
//   only the rim shows, with broken blocks along its lip, and short strokes just beyond it
//   where the ground falls away. No loose rock, which would make it read as facing the viewer.

/** Where the rim runs in a cliff drawn W wide and H tall, as a fraction of H. */
export const CLIFF_RIM = { facing: 0.24, away: 0.58 };

function cliffEdge(r: Rng, W: number, H: number, cy: number, t0: number, t1: number, bow: number, tilt: number) {
  const N = 24;
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const t = lerp(t0, t1, k / N);
    pts.push([W * t, cy + bow * Math.sin(Math.PI * t) + tilt * (t - 0.5) + (r() - 0.5) * H * 0.025]);
  }
  return chaikin(pts, 2);
}

/** The cliff's pieces along its length (0 to 1): one, or two with a gap for a broken cliff. */
function cliffSegments(r: Rng, shape: CliffShape): [number, number][] {
  if (shape === 'broken') {
    const at = 0.35 + r() * 0.3;
    const gap = 0.05 + r() * 0.05;
    return [
      [0.05, at - gap / 2],
      [at + gap / 2, 0.95],
    ];
  }
  return [[0.05, 0.95]];
}

interface Rock {
  x: number;
  y: number;
  size: number;
}

function drawRocks(ctx: CanvasRenderingContext2D, r: Rng, rocks: Rock[], U: number, c: ArtColors) {
  rocks.sort((a, b) => a.y - b.y);
  for (const rock of rocks) {
    const pts: Pt[] = [];
    const n = 5 + Math.floor(r() * 3);
    const spin = r() * Math.PI;
    for (let k = 0; k < n; k++) {
      const a = spin + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const rr = rock.size * (0.65 + r() * 0.55);
      pts.push([rock.x + Math.cos(a) * rr, rock.y + Math.sin(a) * rr * 0.72]);
    }
    const shape = pathOf(pts, true);
    clearShape(ctx, shape, c.fill);
    ctx.save();
    ctx.clip(shape);
    ctx.beginPath();
    ctx.rect(rock.x - rock.size * 0.2, rock.y - rock.size, rock.size * 1.6, rock.size * 2);
    ctx.clip();
    for (let x = rock.x - rock.size * 0.2; x < rock.x + rock.size * 1.3; x += U * LINE.hatchGap * 0.9)
      ink(ctx, [[x, rock.y - rock.size], [x, rock.y + rock.size]], U * LINE.lit, r, { taperStart: 0.05, taperEnd: 0.4 });
    ctx.restore();
    ink(ctx, [...pts, pts[0]], U * LINE.lit * 1.3, r, { taperStart: 0.02, taperEnd: 0.02, minFrac: 0.6 });
  }
  // Pebbles among the rocks.
  ctx.fillStyle = c.color;
  for (let k = 0; k < rocks.length * 3; k++) {
    const rock = rocks[Math.floor(r() * rocks.length)];
    if (!rock) break;
    ctx.beginPath();
    ctx.arc(rock.x + (r() - 0.5) * U * 0.08, rock.y + (r() - 0.4) * U * 0.04, U * (0.0018 + r() * 0.0028), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A cliff whose drop faces the viewer. Drawn W wide and H tall (H about 0.67 W); the rim runs about a quarter of the way down. */
export function cliffFacing(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors, shape: CliffShape) {
  const r = rng(seed);
  const U = W / 0.9;
  ctx.strokeStyle = c.color;
  const cy = H * CLIFF_RIM.facing;
  const bow = (r() - 0.5) * H * 0.04;
  const tilt = (r() - 0.5) * H * 0.06;
  const tall = H * (0.42 + r() * 0.16);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  // Even, or tapering toward one end until the face meets the rim.
  const taper = shape === 'taper-left' ? -1 : shape === 'taper-right' ? 1 : 0;
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // How tall the face is along the whole cliff (t from 0.05 to 0.95, across any break).
  const heightAt = (t: number) => {
    const u = Math.max(0, Math.min(1, (t - 0.05) / 0.9));
    const even = tall * (0.9 + 0.06 * Math.sin(t * 9 + p1) + 0.04 * Math.sin(t * 23 + p2));
    if (taper < 0) return even * smooth(u / 0.85);
    if (taper > 0) return even * smooth((1 - u) / 0.85);
    return even * (0.85 + 0.15 * Math.min(1, Math.min(u, 1 - u) / 0.06));
  };
  const density = (t: number) => 0.5 + 0.3 * Math.sin(t * 17 + p1) + 0.2 * Math.sin(t * 41 + p2);
  const rocks: Rock[] = [];
  for (const [t0, t1] of cliffSegments(r, shape)) {
    const edge = cliffEdge(r, W, H, cy, t0, t1, bow, tilt);
    const first = edge[0];
    const last = edge[edge.length - 1];
    const bottomY = (x: number) => (yAt(edge, Math.max(first[0], Math.min(last[0], x))) ?? cy) + heightAt(x / W) * 1.1;
    const xl = first[0];
    const xr = last[0];
    // The face's area hides what is behind and clips the hatching. No line is drawn along its bottom or sides.
    const area = pathOf([...edge, [xr, bottomY(xr) + U * 0.03], [(xl + xr) / 2, bottomY((xl + xr) / 2) + U * 0.03], [xl, bottomY(xl) + U * 0.03]], true);
    clearShape(ctx, area, c.fill);
    ctx.save();
    ctx.clip(area);
    // Over the last stretch at each end the hatching thins out, so the face fades rather than stopping.
    const fadeAt = (x: number) => Math.min(1, Math.min(x - xl, xr - x) / (U * 0.07));
    // The face: vertical strokes from the rim down, denser in recesses, fading out at different depths.
    for (let x = xl; x < xr; x += U * LINE.hatchGap * (0.55 + 1.4 * (1 - density(x / W))) * (0.85 + r() * 0.3)) {
      if (density(x / W) < 0.22 && r() < 0.5) continue;
      if (r() > fadeAt(x) * 0.9 + 0.1) continue;
      const yTop = yAt(edge, x);
      if (yTop === null) continue;
      const h = heightAt(x / W);
      if (h <= 0) continue;
      const len = h * (0.65 + r() * 0.45) * (0.6 + 0.4 * fadeAt(x));
      if (r() < 0.3) {
        const cut = 0.3 + r() * 0.35;
        ink(ctx, [[x, yTop - U * 0.004], [x + (r() - 0.5) * U * 0.004, yTop + len * cut]], U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.25, minFrac: 0.4 });
        ink(ctx, [[x + (r() - 0.5) * U * 0.004, yTop + len * (cut + 0.05)], [x + (r() - 0.5) * U * 0.008, yTop + len]], U * LINE.hatch, r, { taperStart: 0.08, taperEnd: 0.75, minFrac: 0.2 });
      } else ink(ctx, wobble(r, [[x, yTop - U * 0.004], [x + (r() - 0.5) * U * 0.008, yTop + len]], U * 0.002, U * 0.02), U * LINE.hatch, r, { taperStart: 0.03, taperEnd: 0.7, minFrac: 0.2 });
    }
    // Cracks: darker jagged lines a long way down the face.
    for (let k = 0, nc = 2 + Math.floor(r() * 3); k < nc; k++) {
      const t = lerp(t0, t1, 0.1 + r() * 0.8);
      const x = W * t;
      const yTop = yAt(edge, x);
      if (yTop === null) continue;
      const pts: Pt[] = [[x, yTop]];
      displace(r, [x, yTop], [x + (r() - 0.5) * U * 0.03, yTop + heightAt(t) * (0.55 + r() * 0.35)], 0.25, 3, pts);
      ink(ctx, pts, U * LINE.ridge * 0.9, r, { taperStart: 0.05, taperEnd: 0.7 });
    }
    // Ledges and rock layers partway down.
    for (let l = 0, nl = 1 + Math.floor(r() * 3); l < nl; l++) {
      const a = lerp(t0, t1, r() * 0.6);
      const b = Math.min(t1, a + (t1 - t0) * (0.12 + r() * 0.3));
      const depthAt = 0.25 + r() * 0.35;
      const pts: Pt[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = lerp(a, b, k / 6);
        const yTop = yAt(edge, W * t);
        if (yTop !== null) pts.push([W * t, yTop + heightAt(t) * depthAt + (r() - 0.5) * U * 0.004]);
      }
      if (pts.length > 2) ink(ctx, pts, U * LINE.lit * 1.3, r, { taperStart: 0.25, taperEnd: 0.25 });
    }
    ctx.restore();
    // The rim, thinning out to nothing at each end.
    ink(ctx, edge, U * LINE.outline, r, { taperStart: 0.1, taperEnd: 0.1, minFrac: 0.05 });
    // Loose rock at the foot, more below the taller parts.
    const count = Math.round((t1 - t0) * (16 + r() * 12));
    for (let k = 0; k < count; k++) {
      const t = lerp(t0, t1, r());
      const x = W * t;
      const h = heightAt(t);
      if (h < tall * 0.2) continue;
      const big = r() < 0.15;
      rocks.push({ x: x + (r() - 0.5) * U * 0.03, y: bottomY(x) - h * 0.05 + U * r() * 0.05, size: U * (big ? 0.022 + r() * 0.012 : 0.006 + r() * 0.012) * (0.7 + (h / tall) * 0.4) });
    }
  }
  drawRocks(ctx, r, rocks, U, c);
}

/** A cliff whose drop faces away from the viewer: the face is hidden behind the rim. Drawn W wide and H tall; the rim runs a little below the middle. */
export function cliffAway(ctx: CanvasRenderingContext2D, seed: number, W: number, H: number, c: ArtColors, shape: CliffShape) {
  const r = rng(seed);
  const U = W / 0.9;
  ctx.strokeStyle = c.color;
  const cy = H * CLIFF_RIM.away;
  const bow = (r() - 0.5) * H * 0.1;
  const tilt = (r() - 0.5) * H * 0.08;
  for (const [t0, t1] of cliffSegments(r, shape)) {
    const edge = cliffEdge(r, W, H, cy, t0, t1, bow, tilt);
    const first = edge[0];
    const last = edge[edge.length - 1];
    // The high ground on the near side of the rim hides whatever is behind it.
    clearShape(ctx, pathOf([...edge, [last[0], cy + H * 0.18], [first[0], cy + H * 0.18]], true), c.fill);
    // Beyond the rim: short strokes where the ground falls away out of sight.
    ctx.save();
    ctx.clip(pathOf([...edge, [last[0], 0], [first[0], 0]], true));
    for (let x = first[0] + U * 0.004; x < last[0] - U * 0.004; x += U * LINE.hatchGap * 1.8 * (0.7 + r() * 0.6)) {
      const y = yAt(edge, x);
      if (y === null) continue;
      const fade = Math.min(1, Math.min(x - first[0], last[0] - x) / (U * 0.07));
      if (r() > fade * 0.9 + 0.1) continue;
      const len = U * (0.016 + r() * 0.026) * (0.6 + 0.4 * fade);
      ink(ctx, [[x, y - U * 0.004], [x + (r() - 0.5) * U * 0.006, y - len]], U * LINE.lit, r, { taperStart: 0.05, taperEnd: 0.7 });
    }
    ctx.restore();
    // The lip: a thin line just on the near side of the rim, broken into blocks with short joints.
    const lip: Pt[] = edge.map(([x, y]) => [x, y + U * (0.014 + r() * 0.006)]);
    let k = 0;
    while (k < lip.length - 2) {
      const len = 3 + Math.floor(r() * 6);
      const run = lip.slice(k, Math.min(lip.length, k + len));
      if (r() < 0.75 && run.length > 1) {
        ink(ctx, run, U * LINE.lit * 1.2, r, { taperStart: 0.15, taperEnd: 0.15 });
        const [jx, jy] = run[run.length - 1];
        const ey = yAt(edge, jx);
        if (ey !== null) ink(ctx, [[jx, ey], [jx + U * 0.002, jy + U * 0.004]], U * LINE.lit, r, { taperStart: 0.1, taperEnd: 0.1 });
      }
      k += len + 1 + Math.floor(r() * 2);
    }
    // A tapering cliff's rim fades out over most of its length toward that end, as the drop dies away.
    ink(ctx, edge, U * LINE.outline, r, { taperStart: shape === 'taper-left' ? 0.7 : 0.1, taperEnd: shape === 'taper-right' ? 0.7 : 0.1, minFrac: 0.05 });
  }
}
