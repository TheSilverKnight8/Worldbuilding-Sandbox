import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Download, Globe2, HardDrive, Plus, Trash2, Upload } from 'lucide-react';
import { alertDialog, confirmDialog, notify, promptDialog } from '../components/dialogs';
import { Button, Card, IconButton, Spinner, cx } from '../components/ui';
import { MAX_WORLDS } from '../config';
import { createWorld, deleteWorld, exportWorld, importWorld, useApp } from '../lib/store';
import { FILE_SUFFIX } from '../lib/world/format';
import type { WorldMeta } from '../lib/world/types';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function megabytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? 'under 0.1 MB' : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const refuseFull = () =>
  alertDialog({
    title: `${MAX_WORLDS} worlds already`,
    body: `The app holds up to ${MAX_WORLDS} worlds. Delete one first, then import.`,
  });

export function Home() {
  const navigate = useNavigate();
  const boot = useApp((s) => s.boot);
  const worlds = useApp((s) => s.worlds);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  if (boot.kind === 'loading')
    return (
      <div className="flex items-center gap-3 py-20 text-muted">
        <Spinner />
        Starting
      </div>
    );

  if (boot.kind === 'error')
    return (
      <div className="max-w-2xl animate-rise">
        <p className="label-caps text-accent">Storage</p>
        <h1 className="mt-2 text-5xl">The app cannot open its storage</h1>
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-warn/35 bg-warn/10 p-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {boot.message}
        </p>
        <p className="mt-4 text-muted">Worlds are saved in this browser's storage. Check that Chrome is not blocking site data for this page, then reload.</p>
      </div>
    );

  const create = async () => {
    const name = await promptDialog({ title: 'New world', label: 'Name', confirm: 'Create world' });
    if (!name) return;
    const r = await createWorld(name);
    if (!r.ok) return void alertDialog({ title: 'Could not create the world', body: r.reason });
    navigate(`/world/${r.value}`);
  };

  const startImport = () => {
    if (worlds.length >= MAX_WORLDS) return void refuseFull();
    fileInput.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    const r = await importWorld(file);
    setImporting(false);
    if (r.ok) return notify(`Imported “${r.value.name}”.`);
    if (r.full) return void refuseFull();
    void alertDialog({ title: 'Could not import this file', body: r.reason });
  };

  const slots: (WorldMeta | null)[] = Array.from({ length: MAX_WORLDS }, (_, i) => worlds[i] ?? null);

  return (
    <div className="animate-rise">
      <p className="label-caps text-accent">Worlds</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl lg:text-6xl">Your worlds</h1>
        <Button onClick={startImport} loading={importing}>
          {!importing && <Upload className="size-4" />}
          Import world
        </Button>
      </div>
      <p className="mt-3 text-muted">
        Up to {MAX_WORLDS} worlds. Changes save by themselves in this browser. Export saves a world as one file ({FILE_SUFFIX}), images included.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept={`${FILE_SUFFIX},application/json,.json`}
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {slots.map((w, i) => (w ? <WorldCard key={w.id} world={w} /> : <EmptySlot key={`empty-${i}`} onCreate={() => void create()} />))}
      </div>

      <StorageNote />
    </div>
  );
}

function WorldCard({ world }: { world: WorldMeta }) {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    setExporting(true);
    const r = await exportWorld(world.id);
    setExporting(false);
    if (!r.ok) void alertDialog({ title: 'Could not export the world', body: r.reason });
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${world.name}”?`,
      body: 'The world and everything in it are removed from this browser. This cannot be undone.',
      confirm: 'Delete world',
      danger: true,
    });
    if (!ok) return;
    const r = await deleteWorld(world.id);
    if (!r.ok) void alertDialog({ title: 'Could not delete the world', body: r.reason });
  };

  return (
    <Card className="flex min-h-56 flex-col transition hover:border-navy/40">
      <button className="flex flex-1 flex-col items-start p-5 text-left" onClick={() => navigate(`/world/${world.id}`)}>
        <span className="flex size-12 items-center justify-center rounded-xl bg-navy text-on-accent">
          <Globe2 className="size-6" />
        </span>
        <span className="mt-4 line-clamp-2 font-display text-2xl uppercase leading-tight tracking-wide">{world.name}</span>
        <span className="mt-2 text-sm text-muted">Created {dateFormat.format(new Date(world.createdAt))}</span>
        <span className="text-sm text-muted">Changed {dateTimeFormat.format(new Date(world.updatedAt))}</span>
      </button>
      <div className="flex items-center gap-1 border-t border-line px-3 py-2">
        <Button variant="primary" size="sm" onClick={() => navigate(`/world/${world.id}`)}>
          Open
        </Button>
        <div className="flex-1" />
        <IconButton label="Export" onClick={() => void doExport()} disabled={exporting}>
          {exporting ? <Spinner className="size-4" /> : <Download className="size-4" />}
        </IconButton>
        <IconButton label="Delete" onClick={() => void remove()}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </Card>
  );
}

function EmptySlot({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      onClick={onCreate}
      className={cx(
        'flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted transition',
        'hover:border-navy/40 hover:bg-surface hover:text-ink',
      )}
    >
      <Plus className="size-8" />
      <span className="mt-2 font-display text-xl uppercase tracking-wide">New world</span>
    </button>
  );
}

function StorageNote() {
  const storage = useApp((s) => s.storage);
  const count = useApp((s) => s.worlds.length);
  if (!count && storage.usage === null) return null;
  return (
    <p className="mt-8 flex items-start gap-2 text-sm text-muted">
      <HardDrive className="mt-0.5 size-4 shrink-0" />
      <span>
        Saved in this browser on this computer, nowhere else
        {storage.usage !== null && <>, using {megabytes(storage.usage)}</>}.
        {storage.persisted === true && ' Chrome keeps this storage even when the disk runs low.'}
        {storage.persisted === false && count > 0 && ' Chrome has not agreed to keep this storage when the disk runs low, so it could clear it then.'}
      </span>
    </p>
  );
}
