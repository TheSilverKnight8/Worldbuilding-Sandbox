// The shape of a world. Agreed with Caleb in Stage 1 (docs/decisions.md, "Data structure"),
// because it is costly to change once material is entered.
//
// - Everything in a world is a record with an ID and a kind.
// - Records point at each other only by ID, so renaming never breaks a link, and a
//   name never changes because something else changed.
// - Structured fields live on the record. Free write and images are optional, so a
//   map node nobody wrote up costs only its fields and location.
// - Big binary data (images, map data) is stored apart from the records, as blobs, and
//   records refer to it by blob ID.

/** Every kind of record the spec names (SPEC.md, "Entry types and fields"). Each kind's fields are added in the stage that builds it. */
export type RecordKind =
  // On the map
  | 'settlement'
  | 'feature'
  | 'landmark'
  | 'road'
  | 'info'
  | 'group'
  | 'biome'
  // Peoples and diplomacy
  | 'nation'
  | 'culture'
  | 'faction'
  | 'strand'
  // Time
  | 'timeline'
  | 'event'
  // Language
  | 'language';

export const RECORD_KINDS: readonly RecordKind[] = [
  'settlement',
  'feature',
  'landmark',
  'road',
  'info',
  'group',
  'biome',
  'nation',
  'culture',
  'faction',
  'strand',
  'timeline',
  'event',
  'language',
];

/** Values a structured field can hold. Each kind's stage narrows this to real field types. */
export type FieldValue = string | number | boolean | null | string[] | number[] | { [key: string]: FieldValue };

export interface WorldRecord {
  id: string;
  kind: RecordKind;
  name: string;
  /** Structured fields for this kind: only details Caleb would filter or compare by. Everything else is free write. */
  fields: Record<string, FieldValue>;
  /** Free write. Left out when the record is not written up. */
  text?: string;
  /** Blob IDs of attached images. */
  images?: string[];
  /** IDs of other records this entry links to. */
  links?: string[];
}

/**
 * The map (Stage 2). A graph of irregular polygons (cells), made once when the map is set
 * up and stored as a blob, plus one byte per cell saying whether it is land.
 * Positions are in map units (the long side is 1000); kilometers come from widthKm and heightKm.
 */
export interface MapInfo {
  /** The map's real size, set by Caleb. */
  widthKm: number;
  heightKm: number;
  /** The same size in map units. */
  width: number;
  height: number;
  cellCount: number;
  /** Seeds the wiggle of coastlines (noisy edges), so they come out the same every time. */
  seed: number;
  /** Blob ID of the polygon graph (see lib/map/graph.ts). */
  graphBlob: string;
  /** Blob ID of the land grid: one byte per cell, 1 = land, 0 = water. */
  landBlob: string;
  /** Blob ID of the biome grid (Stage 3): one byte per cell, an index into biomeSlots (0 = no biome). */
  biomeBlob: string;
  /** Biome record IDs by grid index. Slot 0 is always null (no biome); a deleted biome leaves its slot null. */
  biomeSlots: (string | null)[];
  /** True once the starter biomes were added, so they are not added again after Caleb deletes them. */
  biomesSeeded: boolean;
  /** Blob ID of the base elevation (Stage 4): Int16 meters above sea level per cell, as painted. Land only. */
  elevationBlob: string;
  /** Icons placed one by one by hand (Stage 4), in the order they were placed. */
  icons: PlacedIcon[];
  /**
   * Icons the app draws by itself (hills and mountains on high ground, a biome's plants) that
   * Caleb took over by selecting them: they are drawn from `icons` now, so the app's own copy
   * is left out. Keys are made in lib/map/terrain.ts and lib/map/icons.ts.
   */
  hiddenAuto: string[];
}

/** How a biome shows on the fantasy atlas (Stage 3): a set of icons drawn in code, or nothing. */
export type IconSet = 'deciduous' | 'pine' | 'jungle' | 'cactus' | 'shrub' | 'grass' | 'dunes' | 'reeds' | 'none';

/** Elevation-based geography (Stage 4): the terrain icons. (Valleys, canyons and passes were dropped at Caleb's request.) */
export type TerrainKind = 'hill' | 'mountain' | 'volcano' | 'plateau' | 'cliff';

/** A cliff's shape along its length, chosen when it is placed. */
export type CliffShape = 'even' | 'taper-left' | 'taper-right' | 'broken';
export const CLIFF_SHAPES: readonly CliffShape[] = ['even', 'taper-left', 'taper-right', 'broken'];

/** Anything that can be placed as a single icon: terrain, or a biome's plants and ground. */
export type IconKind = TerrainKind | Exclude<IconSet, 'none'>;

export const TERRAIN_KINDS: readonly TerrainKind[] = ['mountain', 'hill', 'volcano', 'plateau', 'cliff'];
export const ICON_KINDS: readonly IconKind[] = [...TERRAIN_KINDS, 'deciduous', 'pine', 'jungle', 'cactus', 'shrub', 'grass', 'dunes', 'reeds'];

/**
 * An icon placed by hand. It stays exactly where Caleb put it. Terrain icons also shape
 * the elevation around them, and win over it ("icons come before elevation").
 */
export interface PlacedIcon {
  id: string;
  kind: IconKind;
  /** Ground point, in map units. */
  x: number;
  y: number;
  /** Width in map units. */
  size: number;
  /** Which of the kind's drawings. */
  variant?: number;
  /** Cliffs: the compass direction the drop faces, in degrees (0 north, 90 east, 180 south, toward the viewer). */
  angle?: number;
  /** Cliffs: the shape along its length. */
  shape?: CliffShape;
  /** Meters: the top of a hill, mountain, volcano or plateau; how far a cliff drops. */
  meters?: number;
}

/** A biome's structured fields. Biomes are for land only. */
export interface BiomeFields {
  /** Color on the painterly map, #rrggbb. */
  color: string;
  /** Icons on both maps (in ink on the atlas, in color on the painterly map). */
  icons: IconSet;
}

/** One world: everything except its blobs. */
export interface WorldDoc {
  id: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  records: Record<string, WorldRecord>;
  /** null until the map is set up. */
  map: MapInfo | null;
}

/** What the world list on Home needs, kept apart so Home does not load whole worlds. */
export interface WorldMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** An image or other binary file that belongs to a world. */
export interface WorldBlob {
  worldId: string;
  id: string;
  /** Media type, e.g. image/webp. */
  type: string;
  data: Blob;
}

export function metaOf(doc: WorldDoc): WorldMeta {
  return { id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}
