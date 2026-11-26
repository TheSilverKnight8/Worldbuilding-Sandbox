import { seededRandom } from '../rng';

// The atlas's paper: a parchment texture made in code (no image files), seamless so it
// can repeat across the map. Soft blotches from several layers of smooth noise, plus a
// fine grain.

const SIZE = 512;
let texture: HTMLCanvasElement | null = null;

/** Smooth random values on a grid that wraps around, so the texture tiles without seams. */
function wrappingNoise(period: number, rand: () => number) {
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (x: number, y: number) => {
    const fx = (x / SIZE) * period;
    const fy = (y / SIZE) * period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (gx: number, gy: number) => grid[((gy % period) + period) % period * period + (((gx % period) + period) % period)];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

/** The parchment tile (made once, then reused). */
export function paperTexture(): HTMLCanvasElement {
  if (texture) return texture;
  const rand = seededRandom(20261126);
  const layers = [
    { n: wrappingNoise(4, rand), w: 0.42 },
    { n: wrappingNoise(8, rand), w: 0.26 },
    { n: wrappingNoise(16, rand), w: 0.16 },
    { n: wrappingNoise(32, rand), w: 0.1 },
    { n: wrappingNoise(64, rand), w: 0.06 },
  ];
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  // Light and dark parchment.
  const light = [244, 233, 206];
  const dark = [222, 203, 163];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let v = 0;
      for (const l of layers) v += l.n(x, y) * l.w;
      // Stretch the contrast a little and add grain.
      v = Math.min(1, Math.max(0, (v - 0.5) * 1.6 + 0.5 + (rand() - 0.5) * 0.07));
      const i = (y * SIZE + x) * 4;
      img.data[i] = dark[0] + (light[0] - dark[0]) * v;
      img.data[i + 1] = dark[1] + (light[1] - dark[1]) * v;
      img.data[i + 2] = dark[2] + (light[2] - dark[2]) * v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  texture = c;
  return c;
}

/** How many map units one paper tile covers. */
export const PAPER_TILE_UNITS = 180;
export const PAPER_TILE_PIXELS = SIZE;
