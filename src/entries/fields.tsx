import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, X } from 'lucide-react';
import { cx } from '../components/ui';
import { updateEntry } from '../lib/store';
import {
  ERAS,
  MONTHS,
  daysIn,
  demographicsValue,
  formatNumber,
  kindOptions,
  nameOf,
  readDate,
  readDemographics,
  readEra,
  readKind,
  readNumber,
  readRef,
  readRefs,
  readSize,
  readText,
  type FieldDef,
  type SizeUnit,
} from '../lib/world/entries';
import type { FieldValue, RecordKind, WorldDoc, WorldRecord } from '../lib/world/types';

// The editors for an entry's fields, one per kind of field. They are plain form controls,
// styled by the entry page's look (see .entry-field in index.css).

interface Props {
  def: FieldDef;
  entry: WorldRecord;
  doc: WorldDoc;
}

const set = (entry: WorldRecord, key: string, value: FieldValue | undefined) => updateEntry(entry.id, { fields: { [key]: value } });

/** Entries of the given kinds (all entry kinds for 'any'), by name, leaving out `except`. */
function candidates(doc: WorldDoc, to: RecordKind[] | 'any', except: string) {
  return Object.values(doc.records)
    .filter((r) => r.id !== except && (to === 'any' ? r.kind !== 'strand' && r.kind !== 'event' && r.kind !== 'timeline' : to.includes(r.kind)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A link to an entry, for beside a field. */
function OpenLink({ doc, id }: { doc: WorldDoc; id: string }) {
  if (!doc.records[id]) return null;
  return (
    <Link to={`/world/${doc.id}/entries/${id}`} className="entry-open" title={`Open ${nameOf(doc, id)}`} aria-label={`Open ${nameOf(doc, id)}`}>
      <ArrowUpRight className="size-4" />
    </Link>
  );
}

/** A number field that keeps what is typed until it is a number (or empty, which clears it). */
function NumberInput({ value, onCommit, label, min, className }: { value: number | null; onCommit: (v: number | null) => void; label: string; min?: number; className?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = (t: string) => {
    if (!t.trim()) return onCommit(null);
    const n = Number(t);
    if (Number.isFinite(n) && (min === undefined || n >= min)) onCommit(n);
    else setText(value === null ? '' : String(value));
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      className={cx('entry-input', className)}
      value={text}
      min={min}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function FieldEditor({ def, entry, doc }: Props) {
  const value = entry.fields[def.key];
  const listId = useId();
  switch (def.type) {
    case 'number':
      return (
        <span className="flex items-baseline gap-2">
          <NumberInput label={def.label} value={readNumber(value)} min={0} onCommit={(v) => set(entry, def.key, v ?? undefined)} className="w-40" />
          {def.unit && <span className="entry-muted">{def.unit}</span>}
        </span>
      );
    case 'era':
      return (
        <select aria-label={def.label} className="entry-input" value={readEra(value) ?? ''} onChange={(e) => set(entry, def.key, e.target.value === '' ? undefined : Number(e.target.value))}>
          <option value="">Not set</option>
          {ERAS.map((era, i) => (
            <option key={era} value={i}>
              {era}
            </option>
          ))}
        </select>
      );
    case 'date':
      return <DateEditor label={def.label} value={readDate(value)} onChange={(d) => set(entry, def.key, d ?? undefined)} />;
    case 'ref': {
      const id = readRef(value);
      return (
        <span className="flex items-center gap-1.5">
          <select aria-label={def.label} className="entry-input min-w-48" value={id ?? ''} onChange={(e) => set(entry, def.key, e.target.value || undefined)}>
            <option value="">{def.none ?? 'Not set'}</option>
            {id && !doc.records[id] && <option value={id}>Deleted entry</option>}
            {candidates(doc, def.to, entry.id).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || 'Untitled'}
              </option>
            ))}
          </select>
          {id && <OpenLink doc={doc} id={id} />}
        </span>
      );
    }
    case 'refs': {
      const ids = readRefs(value);
      const rest = candidates(doc, def.to, entry.id).filter((r) => !ids.includes(r.id));
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {ids.map((id) => (
            <span key={id} className="entry-chip">
              <Link to={`/world/${doc.id}/entries/${id}`}>{nameOf(doc, id)}</Link>
              <button type="button" aria-label={`Remove ${nameOf(doc, id)}`} onClick={() => set(entry, def.key, ids.filter((x) => x !== id))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          {rest.length > 0 && (
            <select aria-label={`Add to ${def.label}`} className="entry-input" value="" onChange={(e) => e.target.value && set(entry, def.key, [...ids, e.target.value])}>
              <option value="">Add…</option>
              {rest.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'Untitled'}
                </option>
              ))}
            </select>
          )}
          {!ids.length && !rest.length && <span className="entry-muted">No entries to add yet.</span>}
        </span>
      );
    }
    case 'kind':
      return (
        <>
          <TextInput label={def.label} value={readKind(value) ?? ''} list={listId} onCommit={(v) => set(entry, def.key, v.trim() || undefined)} />
          <datalist id={listId}>
            {kindOptions(doc, def.list).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      );
    case 'text':
      return <TextArea label={def.label} value={readText(value)} hint={def.hint} onCommit={(v) => set(entry, def.key, v.trim() ? v : undefined)} />;
    case 'demographics':
      return <DemographicsEditor entry={entry} doc={doc} def={def} />;
    case 'size': {
      const s = readSize(value);
      return (
        <span className="flex items-baseline gap-2">
          <NumberInput label={def.label} value={s?.value ?? null} min={0} onCommit={(v) => set(entry, def.key, v === null ? undefined : { value: v, unit: s?.unit ?? 'km²' })} className="w-36" />
          <select aria-label={`${def.label} unit`} className="entry-input" value={s?.unit ?? 'km²'} onChange={(e) => s && set(entry, def.key, { value: s.value, unit: e.target.value as SizeUnit })}>
            <option value="km²">km²</option>
            <option value="km">km</option>
          </select>
        </span>
      );
    }
  }
}

/** A one-line text field that saves when it loses focus (or on Enter). */
function TextInput({ label, value, onCommit, list }: { label: string; value: string; onCommit: (v: string) => void; list?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      aria-label={label}
      list={list}
      className="entry-input min-w-56"
      value={text}
      placeholder="Pick or type one"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function TextArea({ label, value, hint, onCommit }: { label: string; value: string; hint?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      aria-label={label}
      rows={2}
      className="entry-input w-full resize-y"
      value={text}
      placeholder={hint}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
    />
  );
}

/** A date to the day where known: day and month are optional; years before 1 are BC (no year 0). */
function DateEditor({ label, value, onChange }: { label: string; value: { y: number; m?: number; d?: number } | null; onChange: (d: { y: number; m?: number; d?: number } | null) => void }) {
  const [year, setYear] = useState(value ? String(Math.abs(value.y)) : '');
  const [bc, setBc] = useState(value ? value.y < 0 : false);
  useEffect(() => {
    setYear(value ? String(Math.abs(value.y)) : '');
    setBc(value ? value.y < 0 : false);
  }, [value?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const build = (y: string, isBc: boolean, m?: number, d?: number) => {
    const n = Number(y);
    if (!y.trim()) return onChange(null);
    if (!Number.isInteger(n) || n < 1) return;
    const yy = isBc ? -n : n;
    const out: { y: number; m?: number; d?: number } = { y: yy };
    if (m) {
      out.m = m;
      if (d && d <= daysIn(yy, m)) out.d = d;
    }
    onChange(out);
  };
  const m = value?.m;
  const days = m && value ? daysIn(value.y, m) : 31;
  return (
    <span className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <select aria-label={`${label}: day`} className="entry-input" value={value?.d ?? ''} disabled={!m} onChange={(e) => value && build(String(Math.abs(value.y)), value.y < 0, m, Number(e.target.value) || undefined)}>
        <option value="">Day</option>
        {Array.from({ length: days }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            {i + 1}
          </option>
        ))}
      </select>
      <select aria-label={`${label}: month`} className="entry-input" value={m ?? ''} disabled={!value} onChange={(e) => value && build(String(Math.abs(value.y)), value.y < 0, Number(e.target.value) || undefined, value.d)}>
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        aria-label={`${label}: year`}
        placeholder="Year"
        className="entry-input w-24"
        value={year}
        onChange={(e) => setYear(e.target.value)}
        onBlur={(e) => build(e.target.value, bc, value?.m, value?.d)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <select
        aria-label={`${label}: era`}
        className="entry-input"
        value={bc ? 'BC' : 'AD'}
        onChange={(e) => {
          const isBc = e.target.value === 'BC';
          setBc(isBc);
          build(year, isBc, value?.m, value?.d);
        }}
      >
        <option value="AD">AD</option>
        <option value="BC">BC</option>
      </select>
    </span>
  );
}

/** Each culture's share of a settlement's people. */
function DemographicsEditor({ entry, doc, def }: { entry: WorldRecord; doc: WorldDoc; def: FieldDef }) {
  const shares = readDemographics(entry.fields[def.key]);
  const save = (next: typeof shares) => set(entry, def.key, next.length ? demographicsValue(next) : undefined);
  const cultures = Object.values(doc.records)
    .filter((r) => r.kind === 'culture' && !shares.some((s) => s.culture === r.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = shares.reduce((a, s) => a + s.percent, 0);
  return (
    <span className="block space-y-1.5">
      {shares.map((s) => (
        <span key={s.culture} className="flex items-center gap-2">
          <span className="entry-chip">
            <Link to={`/world/${doc.id}/entries/${s.culture}`}>{nameOf(doc, s.culture)}</Link>
          </span>
          <NumberInput label={`${nameOf(doc, s.culture)} share`} value={s.percent} min={0} className="w-20" onCommit={(v) => save(shares.map((x) => (x.culture === s.culture ? { ...x, percent: Math.min(100, v ?? 0) } : x)))} />
          <span className="entry-muted">%</span>
          <button type="button" className="entry-open" aria-label={`Remove ${nameOf(doc, s.culture)}`} onClick={() => save(shares.filter((x) => x.culture !== s.culture))}>
            <X className="size-4" />
          </button>
        </span>
      ))}
      <span className="flex items-center gap-2">
        {cultures.length > 0 ? (
          <select aria-label="Add a culture" className="entry-input" value="" onChange={(e) => e.target.value && save([...shares, { culture: e.target.value, percent: 0 }])}>
            <option value="">Add a culture…</option>
            {cultures.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || 'Untitled'}
              </option>
            ))}
          </select>
        ) : (
          !shares.length && <span className="entry-muted">Add culture entries to give each a share.</span>
        )}
        {shares.length > 0 && <span className={cx('entry-muted', Math.abs(total - 100) > 0.01 && 'entry-warn')}>Total {formatNumber(total)}%</span>}
      </span>
    </span>
  );
}
