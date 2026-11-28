import type { Cliff, PlacedIcon } from '../world/types';
import type { SlotLook } from './biomes';
import { underCliffs, type AutoWaterfall } from './cliffs';
import type { Graph } from './graph';
import { placeIcons, placedToPlacement, variantsOf, type Placement } from './icons';
import { underRivers, type RiverShape } from './rivers';
import { underTerrain } from './terrain';

export { placedToPlacement };

/**
 * Every icon the map draws, back to front: a biome's plants (kept off terrain icons placed
 * by hand, the rivers and the cliffs' faces), the waterfalls where rivers go over cliffs out of
 * sight (`falls`; the ones down a cliff's face are drawn with the cliff), and the icons placed
 * by hand. Used by the editor's map and by the preview of a generated map. (The cliffs
 * themselves are drawn before all of these.)
 */
export function mapIcons(g: Graph, land: Uint8Array, biome: Uint8Array, looks: (SlotLook | null)[], seed: number, placed: PlacedIcon[], hidden: ReadonlySet<string>, shapes: RiverShape[], cliffs: Cliff[], falls: AutoWaterfall[]): Placement[] {
  const keepOff = underTerrain(g, placed);
  const wet = underRivers(g, shapes);
  const faces = underCliffs(g, cliffs);
  for (let c = 0; c < keepOff.length; c++) keepOff[c] |= wet[c] | faces[c];
  const all: Placement[] = placeIcons(g, land, biome, looks, seed, keepOff, hidden);
  for (const w of falls) {
    if (w.sheet || hidden.has(w.key)) continue;
    let h = 0;
    for (let i = 0; i < w.key.length; i++) h = (h * 31 + w.key.charCodeAt(i)) | 0;
    all.push({ x: w.x, y: w.y, size: w.size, set: 'waterfall', variant: Math.abs(h) % variantsOf('waterfall'), angle: w.angle, auto: w.key });
  }
  for (const p of placed) all.push(placedToPlacement(p));
  // Back to front by ground point (a waterfall's point is its lip, so it goes by its foot).
  const depth = (p: Placement) => (p.set === 'waterfall' ? p.y + p.size * 0.7 : p.y);
  all.sort((a, b) => depth(a) - depth(b));
  return all;
}
