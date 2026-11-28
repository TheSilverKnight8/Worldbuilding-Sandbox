import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, ChevronDown, Filter, Plus, Search, Trash2, X } from 'lucide-react';
import { alertDialog, confirmDialog } from '../components/dialogs';
import { Button, Input, Segmented, cx } from '../components/ui';
import { lookFor, onLookChange, setLook } from '../lib/session';
import { PLACE_KINDS, entryElevation } from '../lib/map/nodes';
import { addEntry, deleteEntry, getMap, getMapVersion } from '../lib/store';
import { ENTRY_KINDS, ERAS, KIND_LABEL, formatNumber, KIND_PLURAL, isEntryKind, kindOptions, type EntryKind, type FieldDef } from '../lib/world/entries';
import type { WorldDoc } from '../lib/world/types';
import { EntryPage, type Look } from './EntryPage';
import { Thumb } from './Gallery';
import { NONE, filterable, searchEntries, type EntryQuery, type FieldFilter } from './search';

// The Entries view (Stage 7, Caleb: a world has two views, the map and the entries): a list to
// search and filter on the left, the chosen entry's page on the right.

export function EntriesView({ world, entryId }: { world: WorldDoc; entryId: string | null }) {
  const navigate = useNavigate();
  const look: Look = useSyncExternalStore(onLookChange, () => lookFor(world.id));
  const [query, setQuery] = useState<EntryQuery>({ text: '', kind: 'all', fields: {} });
  const [showFilters, setShowFilters] = useState(false);
  // A place entry's elevation, from the map at its first node (SPEC.md: filtered and compared by it).
  const version = getMapVersion();
  const elevationOf = useMemo(() => {
    const data = getMap();
    const memo = new Map<string, number | null>();
    return (id: string) => {
      if (!memo.has(id)) memo.set(id, entryElevation(world, data, version, id));
      return memo.get(id)!;
    };
  }, [world, version]);
  const hits = useMemo(() => searchEntries(world, query, elevationOf), [world, query, elevationOf]);
  const entry = entryId ? world.records[entryId] : undefined;
  const open = (id: string) => navigate(`/world/${world.id}/entries/${id}`);
  const activeFilters = [...Object.values(query.fields), ...(query.elevation ? [query.elevation] : [])].filter((f) => f.min !== undefined || f.max !== undefined || !!f.value).length;

  const create = (kind: EntryKind) => {
    const r = addEntry(kind);
    if (!r.ok) return void alertDialog({ title: 'Could not add the entry', body: r.reason });
    open(r.value);
    // Ready to name it.
    window.setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('.entry-title');
      el?.focus();
      el?.select();
    }, 50);
  };

  const remove = async () => {
    if (!entry) return;
    const ok = await confirmDialog({
      title: `Delete ${entry.name || 'this entry'}?`,
      body:
        entry.kind === 'biome'
          ? 'The biome is also taken off the map: land painted with it is left with no biome. Its images are deleted.'
          : 'Its fields, free write and images are deleted. Other entries stop pointing at it; links to it in their text show it as deleted.',
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteEntry(entry.id);
    navigate(`/world/${world.id}/entries`);
  };

  return (
    <div className="flex h-full bg-bg">
      <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-surface">
        <div className="space-y-2 border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search entries" placeholder="Search names, text and fields" className="h-9 pl-9 text-sm" value={query.text} onChange={(e) => setQuery({ ...query, text: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Entry type"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-raised px-2 text-sm"
              value={query.kind}
              onChange={(e) => setQuery({ ...query, kind: e.target.value as EntryKind | 'all', fields: {}, elevation: undefined })}
            >
              <option value="all">All types</option>
              {ENTRY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_PLURAL[k]}
                </option>
              ))}
            </select>
            {query.kind !== 'all' && filterable(query.kind).length > 0 && (
              <button
                type="button"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((v) => !v)}
                className={cx('flex h-9 items-center gap-1 rounded-lg border px-2.5 text-sm transition', showFilters || activeFilters ? 'border-navy bg-navy/10 text-ink' : 'border-line bg-raised text-muted hover:text-ink')}
              >
                <Filter className="size-4" />
                Filters{activeFilters ? ` (${activeFilters})` : ''}
              </button>
            )}
          </div>
          {showFilters && query.kind !== 'all' && (
            <Filters
              doc={world}
              kind={query.kind}
              fields={query.fields}
              elevation={query.elevation}
              onChange={(fields, elevation) => setQuery({ ...query, fields, elevation })}
            />
          )}
          <NewEntry onPick={create} />
        </div>
        <p className="px-3 pt-2 text-xs text-muted" aria-live="polite">
          {hits.length} {hits.length === 1 ? 'entry' : 'entries'}
        </p>
        <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2" aria-label="Entries">
          {hits.map(({ record, snippet }) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => open(record.id)}
                aria-current={record.id === entryId ? 'page' : undefined}
                className={cx('flex w-full gap-3 rounded-xl px-2.5 py-2 text-left transition', record.id === entryId ? 'bg-navy text-on-accent' : 'hover:bg-raised')}
              >
                {record.images?.[0] ? (
                  <Thumb blobId={record.images[0]} className="size-11 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-lg font-display text-lg', record.id === entryId ? 'bg-on-accent/15' : 'bg-raised text-muted')}>
                    {KIND_LABEL[record.kind][0]}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{record.name || 'Untitled'}</span>
                  <span className={cx('block truncate text-xs', record.id === entryId ? 'text-on-accent/80' : 'text-muted')}>
                    {KIND_LABEL[record.kind]}
                    {PLACE_KINDS.includes(record.kind as EntryKind) && elevationOf(record.id) !== null && ` · ${formatNumber(elevationOf(record.id)!)} m`}
                  </span>
                  {snippet && <span className={cx('mt-0.5 line-clamp-2 text-xs', record.id === entryId ? 'text-on-accent/80' : 'text-muted')}>{snippet}</span>}
                </span>
              </button>
            </li>
          ))}
          {!hits.length && <li className="px-2.5 py-6 text-center text-sm text-muted">{Object.values(world.records).some((r) => isEntryKind(r.kind)) ? 'No entries match.' : 'No entries yet. Make one with New entry.'}</li>}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Segmented<Look>
            size="sm"
            value={look}
            onChange={(v) => setLook(world.id, v)}
            options={[
              { value: 'atlas', label: 'Atlas' },
              { value: 'painterly', label: 'Painterly' },
            ]}
          />
          <span className="text-xs text-muted">The same look as the map.</span>
          <span className="flex-1" />
          {entry && isEntryKind(entry.kind) && (
            <Button size="sm" variant="danger" onClick={() => void remove()}>
              <Trash2 className="size-4" />
              Delete entry
            </Button>
          )}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {entry && isEntryKind(entry.kind) ? (
            <EntryPage key={entry.id} entry={entry} doc={world} look={look} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted">
              <BookOpen className="size-8" />
              <p className="mt-3 max-w-sm">{entryId ? 'This entry is not here: it may have been deleted.' : 'Pick an entry from the list, or make a new one.'}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function NewEntry({ onPick }: { onPick: (k: EntryKind) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <Button variant="primary" size="sm" className="w-full" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Plus className="size-4" />
        New entry
        <ChevronDown className="size-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop">
          {ENTRY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-raised"
              onClick={() => {
                setOpen(false);
                onPick(k);
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Filters for the chosen type's fields: a range for numbers, sizes, eras and years; a choice for the rest. */
function Filters({
  doc,
  kind,
  fields,
  elevation,
  onChange,
}: {
  doc: WorldDoc;
  kind: EntryKind;
  fields: Record<string, FieldFilter>;
  elevation: FieldFilter | undefined;
  onChange: (f: Record<string, FieldFilter>, elevation: FieldFilter | undefined) => void;
}) {
  const setF = (key: string, f: FieldFilter) => onChange({ ...fields, [key]: f }, elevation);
  const ev = elevation ?? {};
  const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);
  const row = (def: FieldDef, control: React.ReactNode) => (
    <label key={def.key} className="block space-y-1">
      <span className="block text-xs text-muted">{def.label}</span>
      {control}
    </label>
  );
  const sel = 'h-8 w-full rounded-lg border border-line bg-raised px-2 text-sm';
  const box = 'h-8 w-full rounded-lg border border-line bg-raised px-2 text-sm';
  const entriesOf = (k: string[] | 'any') => Object.values(doc.records).filter((r) => (k === 'any' ? isEntryKind(r.kind) : k.includes(r.kind))).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-2.5 rounded-xl border border-line bg-bg p-2.5" aria-label="Filters">
      {filterable(kind).map((def) => {
        const f = fields[def.key] ?? {};
        switch (def.type) {
          case 'number':
          case 'size':
            return row(
              def,
              <span className="flex items-center gap-1.5">
                <input type="number" aria-label={`${def.label} at least`} placeholder="At least" className={box} value={f.min ?? ''} onChange={(e) => setF(def.key, { ...f, min: num(e.target.value) })} />
                <input type="number" aria-label={`${def.label} at most`} placeholder="At most" className={box} value={f.max ?? ''} onChange={(e) => setF(def.key, { ...f, max: num(e.target.value) })} />
              </span>,
            );
          case 'era':
            return row(
              def,
              <span className="flex items-center gap-1.5">
                <select aria-label={`${def.label} from`} className={sel} value={f.min ?? ''} onChange={(e) => setF(def.key, { ...f, min: num(e.target.value) })}>
                  <option value="">From any</option>
                  {ERAS.map((era, i) => (
                    <option key={era} value={i}>
                      {era}
                    </option>
                  ))}
                </select>
                <select aria-label={`${def.label} to`} className={sel} value={f.max ?? ''} onChange={(e) => setF(def.key, { ...f, max: num(e.target.value) })}>
                  <option value="">To any</option>
                  {ERAS.map((era, i) => (
                    <option key={era} value={i}>
                      {era}
                    </option>
                  ))}
                </select>
              </span>,
            );
          case 'date':
            return row(
              def,
              <span className="flex items-center gap-1.5">
                <YearInput label={`${def.label} from year`} placeholder="From year" value={f.min} onChange={(v) => setF(def.key, { ...f, min: v })} />
                <YearInput label={`${def.label} to year`} placeholder="To year" value={f.max} onChange={(v) => setF(def.key, { ...f, max: v })} />
              </span>,
            );
          case 'kind':
            return row(
              def,
              <select aria-label={`${def.label} is`} className={sel} value={f.value ?? ''} onChange={(e) => setF(def.key, { value: e.target.value || undefined })}>
                <option value="">Any</option>
                {kindOptions(doc, def.list).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>,
            );
          case 'ref':
          case 'refs':
          case 'demographics': {
            const to = def.type === 'demographics' ? ['culture'] : def.to;
            return row(
              def,
              <select aria-label={`${def.label} is`} className={sel} value={f.value ?? ''} onChange={(e) => setF(def.key, { value: e.target.value || undefined })}>
                <option value="">Any</option>
                {def.type === 'ref' && def.none && <option value={NONE}>{def.none}</option>}
                {entriesOf(to).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name || 'Untitled'}
                  </option>
                ))}
              </select>,
            );
          }
          default:
            return null;
        }
      })}
      {PLACE_KINDS.includes(kind) && (
        <label className="block space-y-1">
          <span className="block text-xs text-muted">Elevation (m, from the map)</span>
          <span className="flex items-center gap-1.5">
            <input type="number" aria-label="Elevation at least" placeholder="At least" className={box} value={ev.min ?? ''} onChange={(e) => onChange(fields, { ...ev, min: num(e.target.value) })} />
            <input type="number" aria-label="Elevation at most" placeholder="At most" className={box} value={ev.max ?? ''} onChange={(e) => onChange(fields, { ...ev, max: num(e.target.value) })} />
          </span>
        </label>
      )}
      <button type="button" className="flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => onChange({}, undefined)}>
        <X className="size-3.5" />
        Clear filters
      </button>
    </div>
  );
}

/** A year, with years before 1 as BC (stored as negative). */
function YearInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [bc, setBc] = useState(value !== undefined && value < 0);
  const shown = value === undefined ? '' : String(Math.abs(value));
  const emit = (text: string, isBc: boolean) => {
    const n = Number(text);
    onChange(text.trim() && Number.isInteger(n) && n > 0 ? (isBc ? -n : n) : undefined);
  };
  return (
    <span className="flex min-w-0 flex-1 items-center">
      <input type="number" min={1} aria-label={label} placeholder={placeholder} className="h-8 w-full min-w-0 rounded-l-lg border border-line bg-raised px-2 text-sm" value={shown} onChange={(e) => emit(e.target.value, bc)} />
      <select
        aria-label={`${label}: era`}
        className="h-8 rounded-r-lg border border-l-0 border-line bg-raised px-1 text-xs"
        value={bc ? 'BC' : 'AD'}
        onChange={(e) => {
          setBc(e.target.value === 'BC');
          emit(shown, e.target.value === 'BC');
        }}
      >
        <option value="AD">AD</option>
        <option value="BC">BC</option>
      </select>
    </span>
  );
}
