import type { PlacedIcon } from '../world/types';
import type { SlotLook } from './biomes';
import type { Graph } from './graph';
import { placeIcons, variantsOf, type Placement } from './icons';
import { riverWaterfalls, underRivers, type RiverShape } from './rivers';
import { underTerrain } from './terrain';

/** An icon placed by hand, as the map draws it. */
export function placedToPlacement(p: PlacedIcon): Placement {
  let variant = p.variant;
  if (variant === undefined) {
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
    variant = Math.abs(h);
  }
  return { x: p.x, y: p.y, size: p.size, set: p.kind, variant: variant % variantsOf(p.kind), angle: p.angle, shape: p.shape, placed: p.id };
}

/**
 * Every icon the map draws, back to front: a biome's plants (kept off terrain icons placed
 * by hand and off the rivers), the waterfalls where rivers cross cliffs, and the icons placed
 * by hand. Used by the editor's map and by the preview of a generated map.
 */
export function mapIcons(g: Graph, land: Uint8Array, biome: Uint8Array, looks: (SlotLook | null)[], seed: number, placed: PlacedIcon[], hidden: ReadonlySet<string>, shapes: RiverShape[]): Placement[] {
  const keepOff = underTerrain(g, placed);
  const wet = underRivers(g, shapes);
  for (let c = 0; c < keepOff.length; c++) keepOff[c] |= wet[c];
  const all: Placement[] = placeIcons(g, land, biome, looks, seed, keepOff, hidden);
  for (const w of riverWaterfalls(shapes, placed, hidden)) {
    let h = 0;
    for (let i = 0; i < w.key.length; i++) h = (h * 31 + w.key.charCodeAt(i)) | 0;
    all.push({ x: w.x, y: w.y, size: w.size, set: 'waterfall', variant: Math.abs(h) % variantsOf('waterfall'), angle: w.angle, auto: w.key });
  }
  for (const p of placed) all.push(placedToPlacement(p));
  // Back to front by ground point (a waterfall's point is its lip, so it goes by its foot, in front of its cliff).
  const depth = (p: Placement) => (p.set === 'waterfall' ? p.y + p.size * 0.7 : p.y);
  all.sort((a, b) => depth(a) - depth(b));
  return all;
}
