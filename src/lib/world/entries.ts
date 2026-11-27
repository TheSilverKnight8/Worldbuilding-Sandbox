import type { FieldValue, RecordKind, WorldDoc, WorldRecord } from './types';

// Entries (Stage 7): the built-in types and their fields (SPEC.md, "Entry types and fields").
// Fields are stored on the record (`fields`), by key; free write is `text` (simple formatted
// HTML, see src/entries/FreeWrite.tsx) and links made in it are `links` (record IDs). Every
// reader here is defensive: a field holding something unexpected reads as empty.

/** Kinds with entry pages now. Timeline events come with timelines (Stage 10), diplomacy strands with diplomacy (Stage 9). */
export const ENTRY_KINDS = ['settlement', 'nation', 'culture', 'language', 'faction', 'feature', 'landmark', 'road', 'info', 'group', 'biome'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const isEntryKind = (k: string): k is EntryKind => (ENTRY_KINDS as readonly string[]).includes(k);

export const KIND_LABEL: Record<RecordKind, string> = {
  settlement: 'Settlement',
  nation: 'Nation',
  culture: 'Culture',
  language: 'Language',
  faction: 'Faction or people group',
  feature: 'Geographical feature',
  landmark: 'Landmark',
  road: 'Road',
  info: 'Info node',
  group: 'Group',
  biome: 'Biome',
  strand: 'Diplomacy strand',
  timeline: 'Timeline',
  event: 'Timeline event',
};

export const KIND_PLURAL: Record<RecordKind, string> = {
  settlement: 'Settlements',
  nation: 'Nations',
  culture: 'Cultures',
  language: 'Languages',
  faction: 'Factions and people groups',
  feature: 'Geographical features',
  landmark: 'Landmarks',
  road: 'Roads',
  info: 'Info nodes',
  group: 'Groups',
  biome: 'Biomes',
  strand: 'Diplomacy strands',
  timeline: 'Timelines',
  event: 'Timeline events',
};

/** Technology levels, in order (Caleb: named eras, so "Medieval or later" can be filtered). Stored as the index. */
export const ERAS = ['Stone age', 'Bronze age', 'Iron age', 'Medieval', 'Renaissance', 'Early modern', 'Industrial', 'Modern'] as const;

/** Starter lists for kinds and types; values typed in a world are offered there afterwards (Caleb: a list you can add to). */
export const KIND_LISTS = {
  government: ['Monarchy', 'Empire', 'Republic', 'Democracy', 'Oligarchy', 'Theocracy', 'Tribal confederation', 'City-state', 'Dictatorship'],
  faction: ['Guild', 'Religious order', 'Military order', 'Political faction', 'Secret society', 'Clan', 'Trading company', 'Rebel movement', 'People group'],
  feature: ['Mountain range', 'Hills', 'Volcano', 'Plateau', 'Valley', 'Canyon', 'River', 'Lake', 'Sea', 'Bay', 'Strait', 'Island', 'Archipelago', 'Peninsula', 'Cape', 'Forest', 'Jungle', 'Desert', 'Swamp', 'Plain', 'Glacier'],
  landmark: ['Castle', 'Fortress', 'Temple', 'Shrine', 'Ruin', 'Monument', 'Tower', 'Bridge', 'Mine', 'Port', 'Lighthouse', 'Battlefield', 'Tomb', 'Wonder'],
} as const;
export type KindList = keyof typeof KIND_LISTS;

export type FieldDef =
  | { key: string; label: string; type: 'number'; unit?: string }
  | { key: string; label: string; type: 'era' }
  | { key: string; label: string; type: 'date' }
  | { key: string; label: string; type: 'ref'; to: RecordKind[]; none?: string }
  | { key: string; label: string; type: 'refs'; to: RecordKind[] | 'any' }
  | { key: string; label: string; type: 'kind'; list: KindList }
  | { key: string; label: string; type: 'text'; hint?: string }
  | { key: string; label: string; type: 'demographics' }
  | { key: string; label: string; type: 'size' };

/** The structured fields of each type: only details worth filtering or comparing by (SPEC.md). Everything else is free write. */
export const FIELDS: Record<EntryKind, FieldDef[]> = {
  settlement: [
    { key: 'nation', label: 'Nation', type: 'ref', to: ['nation'], none: 'Independent' },
    { key: 'culture', label: 'Dominant culture', type: 'ref', to: ['culture'] },
    { key: 'demographics', label: 'Demographics', type: 'demographics' },
    { key: 'population', label: 'Population', type: 'number' },
    { key: 'tech', label: 'Technology level', type: 'era' },
    { key: 'founded', label: 'Founded', type: 'date' },
  ],
  nation: [
    { key: 'culture', label: 'Dominant culture', type: 'ref', to: ['culture'] },
    { key: 'government', label: 'Government type', type: 'kind', list: 'government' },
    { key: 'capital', label: 'Capital', type: 'ref', to: ['settlement'] },
    { key: 'founded', label: 'Founded', type: 'date' },
  ],
  culture: [{ key: 'language', label: 'Language', type: 'ref', to: ['language'] }],
  language: [
    { key: 'sounds', label: 'Common letters or sounds', type: 'text', hint: 'e.g. th, ae, soft r' },
    { key: 'avoid', label: 'Letters or sounds to avoid', type: 'text', hint: 'e.g. q, x, double vowels' },
    { key: 'syllables', label: 'Typical syllable patterns', type: 'text', hint: 'e.g. CV, CVC; two or three syllables' },
    { key: 'stress', label: 'Stress or emphasis', type: 'text', hint: 'e.g. on the first syllable' },
    { key: 'examples', label: 'Example names', type: 'text', hint: 'e.g. Aldren, Thessa, Morvai' },
  ],
  faction: [
    { key: 'type', label: 'Type', type: 'kind', list: 'faction' },
    { key: 'members', label: 'Membership', type: 'number', unit: 'members' },
    { key: 'nations', label: 'Nations it is in', type: 'refs', to: ['nation'] },
  ],
  feature: [
    { key: 'kind', label: 'Kind', type: 'kind', list: 'feature' },
    { key: 'size', label: 'Size', type: 'size' },
  ],
  landmark: [{ key: 'kind', label: 'Kind', type: 'kind', list: 'landmark' }],
  road: [{ key: 'settlements', label: 'Settlements it connects', type: 'refs', to: ['settlement'] }],
  info: [],
  group: [{ key: 'members', label: 'Members', type: 'refs', to: 'any' }],
  // A biome's color and icons are the map's (shown on its page, see EntryPage).
  biome: [],
};

export const fieldsOf = (kind: RecordKind): FieldDef[] => (isEntryKind(kind) ? FIELDS[kind] : []);

// ------------------------------------------------------------------ reading fields

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const readNumber = (v: FieldValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const readEra = (v: FieldValue | undefined): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < ERAS.length ? v : null);
export const readRef = (v: FieldValue | undefined): string | null => (isStr(v) && v ? v : null);
export const readRefs = (v: FieldValue | undefined): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => isStr(x) && !!x) : []);
export const readKind = (v: FieldValue | undefined): string | null => (isStr(v) && v.trim() ? v : null);
export const readText = (v: FieldValue | undefined): string => (isStr(v) ? v : '');

/** A date in the real-world calendar, to the day where known. Years before 1 are negative (340 BC is -340); there is no year 0. */
export interface EntryDate {
  y: number;
  m?: number;
  d?: number;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function daysIn(y: number, m: number) {
  // Leap years by the Gregorian rule, counting the years before 1 astronomically (1 BC is a leap year).
  const astro = y < 0 ? y + 1 : y;
  const leap = (astro % 4 === 0 && astro % 100 !== 0) || astro % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function readDate(v: FieldValue | undefined): EntryDate | null {
  if (!isObj(v)) return null;
  const y = v.y;
  if (typeof y !== 'number' || !Number.isInteger(y) || y === 0 || Math.abs(y) > 1_000_000) return null;
  const out: EntryDate = { y };
  if (typeof v.m === 'number' && Number.isInteger(v.m) && v.m >= 1 && v.m <= 12) {
    out.m = v.m;
    if (typeof v.d === 'number' && Number.isInteger(v.d) && v.d >= 1 && v.d <= daysIn(y, v.m)) out.d = v.d;
  }
  return out;
}

export function formatDate(d: EntryDate) {
  const year = d.y < 0 ? `${-d.y} BC` : String(d.y);
  if (!d.m) return year;
  return `${d.d ? `${d.d} ` : ''}${MONTHS[d.m - 1]} ${year}`;
}

/** Orders dates (earlier first); a date without a month or day sorts at the start of its year or month. */
export const dateOrder = (d: EntryDate) => d.y * 10000 + (d.m ?? 0) * 100 + (d.d ?? 0);

/** A culture's share of a settlement's people, in percent. Stored as { cultureId: percent }, in the order added. */
export interface Share {
  culture: string;
  percent: number;
}
export function readDemographics(v: FieldValue | undefined): Share[] {
  if (!isObj(v)) return [];
  const out: Share[] = [];
  for (const [culture, percent] of Object.entries(v)) if (culture && typeof percent === 'number' && Number.isFinite(percent)) out.push({ culture, percent: Math.max(0, Math.min(100, percent)) });
  return out;
}
export const demographicsValue = (shares: Share[]): FieldValue => Object.fromEntries(shares.map((s) => [s.culture, s.percent]));

export type SizeUnit = 'km' | 'km²';
export interface Size {
  value: number;
  unit: SizeUnit;
}
export function readSize(v: FieldValue | undefined): Size | null {
  if (!isObj(v) || typeof v.value !== 'number' || !Number.isFinite(v.value) || v.value < 0) return null;
  return { value: v.value, unit: v.unit === 'km²' ? 'km²' : 'km' };
}

// ------------------------------------------------------------------ showing fields

export const nameOf = (doc: WorldDoc, id: string) => doc.records[id]?.name || (doc.records[id] ? 'Untitled' : 'Deleted entry');
export const formatNumber = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** A field's value as words (for the list, search and the page when not editing); '' when empty. */
export function fieldText(def: FieldDef, value: FieldValue | undefined, doc: WorldDoc): string {
  switch (def.type) {
    case 'number': {
      const n = readNumber(value);
      return n === null ? '' : `${formatNumber(n)}${def.unit ? ` ${def.unit}` : ''}`;
    }
    case 'era': {
      const e = readEra(value);
      return e === null ? '' : ERAS[e];
    }
    case 'date': {
      const d = readDate(value);
      return d ? formatDate(d) : '';
    }
    case 'ref': {
      const id = readRef(value);
      return id ? nameOf(doc, id) : (def.none ?? '');
    }
    case 'refs':
      return readRefs(value)
        .map((id) => nameOf(doc, id))
        .join(', ');
    case 'kind':
      return readKind(value) ?? '';
    case 'text':
      return readText(value);
    case 'demographics':
      return readDemographics(value)
        .map((s) => `${nameOf(doc, s.culture)} ${formatNumber(s.percent)}%`)
        .join(', ');
    case 'size': {
      const s = readSize(value);
      return s ? `${formatNumber(s.value)} ${s.unit}` : '';
    }
  }
}

/** The values offered for a kind list in this world: the starter list, then any others typed in it. */
export function kindOptions(doc: WorldDoc, list: KindList): string[] {
  const out: string[] = [...KIND_LISTS[list]];
  const seen = new Set(out.map((v) => v.toLowerCase()));
  for (const r of Object.values(doc.records))
    for (const def of fieldsOf(r.kind))
      if (def.type === 'kind' && def.list === list) {
        const v = readKind(r.fields[def.key]);
        if (v && !seen.has(v.trim().toLowerCase())) {
          seen.add(v.trim().toLowerCase());
          out.push(v.trim());
        }
      }
  return out;
}

/** The record IDs a record's fields point at. */
export function fieldRefs(r: WorldRecord): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const def of fieldsOf(r.kind)) {
    const v = r.fields[def.key];
    if (def.type === 'ref') {
      const id = readRef(v);
      if (id) out.push({ id, label: def.label });
    } else if (def.type === 'refs') for (const id of readRefs(v)) out.push({ id, label: def.label });
    else if (def.type === 'demographics') for (const s of readDemographics(v)) out.push({ id: s.culture, label: def.label });
  }
  return out;
}

/** A record's fields with every reference to `id` taken out (when that entry is deleted). */
export function withoutRef(r: WorldRecord, id: string): WorldRecord | null {
  let changed = false;
  const fields = { ...r.fields };
  for (const def of fieldsOf(r.kind)) {
    const v = fields[def.key];
    if (def.type === 'ref' && readRef(v) === id) {
      delete fields[def.key];
      changed = true;
    } else if (def.type === 'refs' && readRefs(v).includes(id)) {
      const rest = readRefs(v).filter((x) => x !== id);
      if (rest.length) fields[def.key] = rest;
      else delete fields[def.key];
      changed = true;
    } else if (def.type === 'demographics' && readDemographics(v).some((s) => s.culture === id)) {
      const rest = readDemographics(v).filter((s) => s.culture !== id);
      if (rest.length) fields[def.key] = demographicsValue(rest);
      else delete fields[def.key];
      changed = true;
    }
  }
  return changed ? { ...r, fields } : null;
}

/** Entries that point here, from their free write or their fields, with how. */
export function backlinks(doc: WorldDoc, id: string): { record: WorldRecord; via: string[] }[] {
  const out: { record: WorldRecord; via: string[] }[] = [];
  for (const r of Object.values(doc.records)) {
    if (r.id === id || !isEntryKind(r.kind)) continue;
    const via: string[] = [];
    if (r.links?.includes(id)) via.push('mentioned in its text');
    for (const f of fieldRefs(r)) if (f.id === id && !via.includes(f.label.toLowerCase())) via.push(f.label.toLowerCase());
    if (via.length) out.push({ record: r, via });
  }
  return out.sort((a, b) => a.record.name.localeCompare(b.record.name));
}

/** A nation's settlements (those whose nation field is it) and their total population. Shown, not stored (SPEC.md). */
export function nationSettlements(doc: WorldDoc, nationId: string) {
  const list = Object.values(doc.records).filter((r) => r.kind === 'settlement' && readRef(r.fields.nation) === nationId);
  let population = 0;
  let counted = 0;
  for (const r of list) {
    const p = readNumber(r.fields.population);
    if (p !== null) {
      population += p;
      counted++;
    }
  }
  return { list: list.sort((a, b) => a.name.localeCompare(b.name)), population, counted };
}

// ------------------------------------------------------------------ free write

const textCache = new Map<string, string>();

/** The words of a free write (HTML), with links shown as the current names of the entries they point at. For search and snippets. */
export function plainText(html: string | undefined, doc: WorldDoc): string {
  if (!html) return '';
  let base = textCache.get(html);
  if (base === undefined) {
    // DOMParser builds an inert document: nothing in it runs.
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    body.querySelectorAll('[data-entry-link]').forEach((el) => (el.textContent = `\u0000${el.getAttribute('data-entry-link') ?? ''}\u0000`));
    body.querySelectorAll('p, h2, h3, li, blockquote').forEach((el) => el.append(' '));
    base = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (textCache.size > 2000) textCache.clear();
    textCache.set(html, base);
  }
  return base.replace(/\u0000([^\u0000]*)\u0000/g, (_, id: string) => nameOf(doc, id));
}

/** The IDs of the entries a free write links to. */
export function linksIn(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/data-entry-link="([^"]+)"/g)) ids.add(m[1]);
  return [...ids];
}
