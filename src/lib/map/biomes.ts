import { newId } from '../ids';
import type { BiomeFields, IconSet, MapInfo, WorldDoc, WorldRecord } from '../world/types';

// Biomes (Stage 3): land only. Each has a name, a painterly color and an atlas icon set.

/** Caleb asked for a short list of broad biomes to start from. All can be renamed, recolored, given other icons or deleted. */
const STARTER: { name: string; color: string; icons: IconSet }[] = [
  { name: 'Forest', color: '#5f8f4e', icons: 'deciduous' },
  { name: 'Pine forest', color: '#3f6b51', icons: 'pine' },
  { name: 'Jungle', color: '#2f7d4a', icons: 'jungle' },
  { name: 'Grassland', color: '#a9c070', icons: 'grass' },
  { name: 'Desert', color: '#e2c98c', icons: 'dunes' },
  { name: 'Swamp', color: '#6e8d6a', icons: 'reeds' },
  { name: 'Tundra', color: '#b8bea6', icons: 'none' },
  { name: 'Ice', color: '#eef2f4', icons: 'none' },
];

/** How a starter biome looks, by name (for previewing a generated map before it is kept). */
export function starterLook(name: string): SlotLook | null {
  const s = STARTER.find((b) => b.name === name);
  return s ? { color: s.color, icons: s.icons } : null;
}

export const ICON_SETS: { value: IconSet; label: string }[] = [
  { value: 'deciduous', label: 'Leafy trees' },
  { value: 'pine', label: 'Pine trees' },
  { value: 'jungle', label: 'Palm trees' },
  { value: 'cactus', label: 'Cacti' },
  { value: 'shrub', label: 'Shrubs' },
  { value: 'grass', label: 'Grass tufts' },
  { value: 'dunes', label: 'Dunes' },
  { value: 'reeds', label: 'Reeds' },
  { value: 'none', label: 'No icons' },
];
const ICON_VALUES = new Set<string>(ICON_SETS.map((s) => s.value));

/** The most biomes a map can hold: the grid stores one byte per cell, and 0 means none. */
export const MAX_BIOMES = 255;

/** Color for land with no biome on the painterly map. */
export const NO_BIOME_COLOR = '#e4d6a6';

export function biomeFields(r: WorldRecord): BiomeFields {
  const f = r.fields as Partial<Record<keyof BiomeFields, unknown>>;
  return {
    color: typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#999999',
    icons: typeof f.icons === 'string' && ICON_VALUES.has(f.icons) ? (f.icons as IconSet) : 'none',
  };
}

export function biomeRecord(name: string, color: string, icons: IconSet): WorldRecord {
  return { id: newId(), kind: 'biome', name, fields: { color, icons } };
}

/** Adds the starter biomes (once per map, and only if the world has none), and gives every biome a grid slot. */
export function seedBiomes(doc: WorldDoc, map: MapInfo): { doc: WorldDoc; map: MapInfo } {
  const records = { ...doc.records };
  if (!map.biomesSeeded && !Object.values(records).some((r) => r.kind === 'biome'))
    for (const s of STARTER) {
      const r = biomeRecord(s.name, s.color, s.icons);
      records[r.id] = r;
    }
  const slots = [...map.biomeSlots];
  for (const r of Object.values(records)) if (r.kind === 'biome' && !slots.includes(r.id) && slots.length <= MAX_BIOMES) slots.push(r.id);
  return { doc: { ...doc, records }, map: { ...map, biomeSlots: slots, biomesSeeded: true } };
}

/** The slot a biome is painted with, giving it one if it has none. Returns null when all slots are taken. */
export function slotFor(map: MapInfo, biomeId: string): { map: MapInfo; slot: number } | null {
  const at = map.biomeSlots.indexOf(biomeId);
  if (at > 0) return { map, slot: at };
  const slots = [...map.biomeSlots];
  const free = slots.indexOf(null, 1);
  if (free > 0) {
    slots[free] = biomeId;
    return { map: { ...map, biomeSlots: slots }, slot: free };
  }
  if (slots.length > MAX_BIOMES) return null;
  slots.push(biomeId);
  return { map: { ...map, biomeSlots: slots }, slot: slots.length - 1 };
}

/** What each slot looks like, for drawing: its color and icon set (null for empty slots). */
export interface SlotLook {
  color: string;
  icons: IconSet;
}

export function slotLooks(doc: WorldDoc, map: MapInfo): (SlotLook | null)[] {
  return map.biomeSlots.map((id, i) => {
    const r = i > 0 && id ? doc.records[id] : undefined;
    return r && r.kind === 'biome' ? biomeFields(r) : null;
  });
}

/** Biomes in the order they were added (by slot). */
export function biomeList(doc: WorldDoc, map: MapInfo | null): WorldRecord[] {
  const all = Object.values(doc.records).filter((r) => r.kind === 'biome');
  const order = (r: WorldRecord) => {
    const i = map ? map.biomeSlots.indexOf(r.id) : -1;
    return i < 0 ? 1e6 : i;
  };
  return all.sort((a, b) => order(a) - order(b));
}
