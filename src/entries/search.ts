import { KIND_LABEL, dateOrder, fieldText, fieldsOf, isEntryKind, plainText, readDate, readDemographics, readEra, readKind, readNumber, readRef, readRefs, readSize, type EntryKind, type FieldDef } from '../lib/world/entries';
import type { WorldDoc, WorldRecord } from '../lib/world/types';

// Finding entries (Stage 7): words in names, free write and field values, then filters by type
// and by the type's fields (a range for numbers, eras and dates; a choice for the rest).

/** A filter on one field: a range (numbers, sizes, eras, dates by year) or a value (an entry, a kind). Empty parts are not applied. */
export interface FieldFilter {
  min?: number;
  max?: number;
  value?: string;
}

export interface EntryQuery {
  text: string;
  kind: EntryKind | 'all';
  fields: Record<string, FieldFilter>;
}

/** The fields of a type that can be filtered by (free text cannot). */
export const filterable = (kind: EntryKind) => fieldsOf(kind).filter((d) => d.type !== 'text');

/** "No nation" as a filter value (a settlement that is independent). */
export const NONE = '__none';

function passes(def: FieldDef, r: WorldRecord, f: FieldFilter): boolean {
  const v = r.fields[def.key];
  const inRange = (n: number | null) => (f.min === undefined || (n !== null && n >= f.min)) && (f.max === undefined || (n !== null && n <= f.max));
  switch (def.type) {
    case 'number':
      return inRange(readNumber(v));
    case 'size':
      return inRange(readSize(v)?.value ?? null);
    case 'era':
      return inRange(readEra(v));
    case 'date': {
      const d = readDate(v);
      // By year, both ends included.
      return (f.min === undefined || (d !== null && dateOrder(d) >= f.min * 10000)) && (f.max === undefined || (d !== null && d.y <= f.max));
    }
    case 'ref':
      return !f.value || (f.value === NONE ? readRef(v) === null : readRef(v) === f.value);
    case 'refs':
      return !f.value || readRefs(v).includes(f.value);
    case 'demographics':
      return !f.value || readDemographics(v).some((s) => s.culture === f.value);
    case 'kind':
      return !f.value || (readKind(v) ?? '').trim().toLowerCase() === f.value.trim().toLowerCase();
    case 'text':
      return true;
  }
}

export interface Hit {
  record: WorldRecord;
  /** Higher is better: whole name matches, then name starts, then anywhere. */
  score: number;
  /** A little of the free write: around the first word found, or its start. */
  snippet: string;
}

const snippetAround = (text: string, at: number) => {
  if (!text) return '';
  const start = Math.max(0, at - 50);
  const out = text.slice(start, start + 150);
  return (start > 0 ? '…' : '') + out + (start + 150 < text.length ? '…' : '');
};

/** The entries that match, best first (by name when nothing is typed). */
export function searchEntries(doc: WorldDoc, q: EntryQuery): Hit[] {
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Hit[] = [];
  for (const r of Object.values(doc.records)) {
    if (!isEntryKind(r.kind)) continue;
    if (q.kind !== 'all' && r.kind !== q.kind) continue;
    if (q.kind !== 'all' && !fieldsOf(r.kind).every((def) => !q.fields[def.key] || passes(def, r, q.fields[def.key]))) continue;
    const text = plainText(r.text, doc);
    if (!words.length) {
      out.push({ record: r, score: 0, snippet: snippetAround(text, 0) });
      continue;
    }
    const name = r.name.toLowerCase();
    const fields = fieldsOf(r.kind)
      .map((def) => fieldText(def, r.fields[def.key], doc))
      .join(' ')
      .toLowerCase();
    const lower = text.toLowerCase();
    const hay = `${name} ${KIND_LABEL[r.kind].toLowerCase()} ${fields} ${lower}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const joined = words.join(' ');
    const score = name === joined ? 3 : name.startsWith(joined) ? 2 : words.every((w) => name.includes(w)) ? 1 : 0;
    const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
    out.push({ record: r, score, snippet: snippetAround(text, at.length ? Math.min(...at) : 0) });
  }
  return out.sort((a, b) => b.score - a.score || (a.record.name || '').localeCompare(b.record.name || '') || a.record.id.localeCompare(b.record.id));
}
