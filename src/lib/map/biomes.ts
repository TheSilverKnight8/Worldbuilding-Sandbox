import { newId } from '../ids';
import type { BiomeFields, MapInfo, Realm, WorldDoc, WorldRecord } from '../world/types';

// Biomes for painting (Stage 2): a name, land or ocean, and a map color.
// Stage 3 adds the rest of the biome fields from the spec.

/** Caleb asked for a list of basic biomes to start from. Ocean biomes go mostly by depth. All of them can be renamed, recolored or deleted. */
const STARTER: { name: string; realm: Realm; color: string; text?: string }[] = [
  { name: 'Tropical rainforest', realm: 'land', color: '#3f7a4a' },
  { name: 'Tropical dry forest', realm: 'land', color: '#7d9a4f' },
  { name: 'Savanna', realm: 'land', color: '#c8b66c' },
  { name: 'Desert', realm: 'land', color: '#e2cd96' },
  { name: 'Mediterranean scrub', realm: 'land', color: '#a8a46c' },
  { name: 'Temperate grassland', realm: 'land', color: '#b5c47f' },
  { name: 'Temperate forest', realm: 'land', color: '#5e9160' },
  { name: 'Boreal forest', realm: 'land', color: '#4a6e5b' },
  { name: 'Tundra', realm: 'land', color: '#a9b4a2' },
  { name: 'Alpine', realm: 'land', color: '#9b9588' },
  { name: 'Wetland', realm: 'land', color: '#6e8f7b' },
  { name: 'Mangrove', realm: 'land', color: '#4f7f6b' },
  { name: 'Ice sheet', realm: 'land', color: '#eef3f5' },
  { name: 'Continental shelf', realm: 'ocean', color: '#8fbcd4', text: 'About 0 to 200 m deep.' },
  { name: 'Continental slope', realm: 'ocean', color: '#5b8db3', text: 'About 200 to 4,000 m deep.' },
  { name: 'Abyssal plain', realm: 'ocean', color: '#2f5d8a', text: 'About 4,000 to 6,000 m deep.' },
  { name: 'Hadal trench', realm: 'ocean', color: '#15345c', text: 'About 6,000 m deep and more.' },
  { name: 'Coral reef', realm: 'ocean', color: '#6fc4c0', text: 'Shallow, warm water.' },
  { name: 'Sea ice', realm: 'ocean', color: '#dce8ee' },
];

/** The most biomes a map can hold: the grid stores one byte per cell, and 0 means none. */
export const MAX_BIOMES = 255;

export function biomeFields(r: WorldRecord): BiomeFields {
  const f = r.fields as Partial<Record<keyof BiomeFields, unknown>>;
  return {
    realm: f.realm === 'ocean' ? 'ocean' : 'land',
    color: typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#999999',
  };
}

export function biomeRecord(name: string, realm: Realm, color: string, text?: string): WorldRecord {
  const r: WorldRecord = { id: newId(), kind: 'biome', name, fields: { realm, color } };
  if (text) r.text = text;
  return r;
}

/** Adds the starter biomes to a world that has none, and gives each one a grid slot. */
export function withStarterBiomes(doc: WorldDoc, map: MapInfo): { doc: WorldDoc; map: MapInfo } {
  const existing = Object.values(doc.records).filter((r) => r.kind === 'biome');
  const records = { ...doc.records };
  const slots = [...map.biomeSlots];
  if (existing.length === 0) {
    for (const s of STARTER) {
      const r = biomeRecord(s.name, s.realm, s.color, s.text);
      records[r.id] = r;
    }
  }
  // Every biome needs a slot to be painted.
  for (const r of Object.values(records)) if (r.kind === 'biome' && !slots.includes(r.id) && slots.length <= MAX_BIOMES) slots.push(r.id);
  return { doc: { ...doc, records }, map: { ...map, biomeSlots: slots } };
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

/** RGBA per slot for the renderer: the biome's color, with alpha 255 for land biomes, 128 for ocean biomes, 0 for an empty slot. */
export function palette(doc: WorldDoc, map: MapInfo): Uint8Array {
  const out = new Uint8Array(256 * 4);
  map.biomeSlots.forEach((id, i) => {
    const r = id ? doc.records[id] : undefined;
    if (!r || r.kind !== 'biome' || i === 0) return;
    const f = biomeFields(r);
    out[i * 4] = parseInt(f.color.slice(1, 3), 16);
    out[i * 4 + 1] = parseInt(f.color.slice(3, 5), 16);
    out[i * 4 + 2] = parseInt(f.color.slice(5, 7), 16);
    out[i * 4 + 3] = f.realm === 'land' ? 255 : 128;
  });
  return out;
}

/** Biomes in list order: land first, then ocean, each in the order they were added. */
export function biomeList(doc: WorldDoc, map: MapInfo | null): WorldRecord[] {
  const all = Object.values(doc.records).filter((r) => r.kind === 'biome');
  const order = (r: WorldRecord) => {
    const i = map ? map.biomeSlots.indexOf(r.id) : -1;
    return i < 0 ? 1e6 : i;
  };
  return all.sort((a, b) => {
    const ra = biomeFields(a).realm;
    const rb = biomeFields(b).realm;
    if (ra !== rb) return ra === 'land' ? -1 : 1;
    return order(a) - order(b);
  });
}
