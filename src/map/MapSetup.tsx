import { useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { alertDialog } from '../components/dialogs';
import { Button, Card, Input } from '../components/ui';
import { DEFAULT_CELLS } from '../lib/map/graph';
import { checkMapSize, setupMap } from '../lib/store';

/** Shown inside a world that has no map yet. */
export function MapSetup() {
  const [width, setWidth] = useState('4000');
  const [height, setHeight] = useState('3000');
  const [busy, setBusy] = useState(false);
  const w = Number(width);
  const h = Number(height);
  const problem = width.trim() && height.trim() ? checkMapSize(w, h) : 'Enter a width and a height.';

  const create = async () => {
    if (problem) return;
    setBusy(true);
    const r = await setupMap(w, h);
    setBusy(false);
    if (!r.ok) void alertDialog({ title: 'Could not set up the map', body: r.reason });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl animate-rise px-6 py-12">
        <p className="label-caps text-accent">Map</p>
        <h1 className="mt-2 text-5xl">Set up the map</h1>
        <p className="mt-3 text-muted">
          Give the map its real size. It starts as open water; you draw the land, and the app draws it as a fantasy atlas. The map is made of {DEFAULT_CELLS.toLocaleString()} irregular polygons, like
          Nortantis.
        </p>
        <Card className="mt-8 p-6">
          <MapIcon className="size-7 text-navy" />
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <SizeField label="Width" value={width} onChange={setWidth} />
              <span className="pb-3 text-muted">×</span>
              <SizeField label="Height" value={height} onChange={setHeight} />
            </div>
            <p className="mt-3 text-sm text-muted">{problem ?? `Area: ${Math.round(w * h).toLocaleString()} km²`}</p>
            <Button type="submit" variant="primary" className="mt-5" loading={busy} disabled={!!problem}>
              {busy ? 'Making the map' : 'Create map'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function SizeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <span className="relative block">
        <Input type="number" inputMode="numeric" min={10} max={40000} step={10} value={value} className="w-40 pr-10 font-mono" onChange={(e) => onChange(e.target.value)} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">km</span>
      </span>
    </label>
  );
}
