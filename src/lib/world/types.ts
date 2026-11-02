// The shape of a world. Agreed with Caleb in Stage 1 (docs/decisions.md, "Data structure"),
// because it is costly to change once material is entered.
//
// - Everything in a world is a record with an ID and a kind.
// - Records point at each other only by ID, so renaming never breaks a link, and a
//   name never changes because something else changed.
// - Structured fields live on the record. Free write and images are optional, so a
//   map node nobody wrote up costs only its fields and location.
// - Anything the app or the simulation works out can also be set by hand (Settable).
// - Big binary data (images, the map backdrop, map layers) is stored apart from the
//   records, as blobs, and records refer to it by blob ID.

/** Every kind of record the spec names. Each kind's fields are added in the stage that builds it. */
export type RecordKind =
  // Map items (Stage 4)
  | 'settlement'
  | 'feature'
  | 'landmark'
  | 'road'
  | 'info'
  | 'group'
  // Libraries (Stage 3)
  | 'biome'
  | 'resource'
  | 'culture'
  | 'language'
  // Nations, factions, diplomacy (Stage 5)
  | 'nation'
  | 'faction'
  | 'strand'
  // Time (Stage 6)
  | 'timeline'
  | 'event';

export const RECORD_KINDS: readonly RecordKind[] = [
  'settlement',
  'feature',
  'landmark',
  'road',
  'info',
  'group',
  'biome',
  'resource',
  'culture',
  'language',
  'nation',
  'faction',
  'strand',
  'timeline',
  'event',
];

/**
 * A value the app or the simulation works out that can also be set by hand.
 * `auto` is what the app or simulation last worked out (left out for values that are
 * worked out fresh every time, like a nation's total population). `manual` is set by
 * hand; when it is present it wins.
 */
export interface Settable<T> {
  auto?: T;
  manual?: T;
}

export function settled<T>(v: Settable<T> | undefined, fallback: T): T {
  if (!v) return fallback;
  return v.manual !== undefined ? v.manual : v.auto !== undefined ? v.auto : fallback;
}

/** Values a structured field can hold. Each kind's stage narrows this to real field types. */
export type FieldValue = string | number | boolean | null | string[] | number[] | Settable<unknown> | { [key: string]: FieldValue };

export interface WorldRecord {
  id: string;
  kind: RecordKind;
  name: string;
  /** Structured fields for this kind (only what the sim reads or changes, or what gets filtered or compared). */
  fields: Record<string, FieldValue>;
  /** Free write. Left out when the record is not written up. */
  text?: string;
  /** Blob IDs of attached images. */
  images?: string[];
  /** IDs of other records this entry links to. */
  links?: string[];
  /** A locked record keeps its identity: the simulation does not change it. */
  locked?: boolean;
}

/** One world: everything except its blobs. */
export interface WorldDoc {
  id: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  records: Record<string, WorldRecord>;
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
