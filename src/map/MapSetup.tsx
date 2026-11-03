import { useRef, useState } from 'react';
import { ImagePlus, Map as MapIcon } from 'lucide-react';
import { alertDialog } from '../components/dialogs';
import { Button, Card, Segmented } from '../components/ui';
import { GRID_LONG_SIDE } from '../lib/map/grid';
import { setupMap } from '../lib/store';

const SHAPES = {
  wide: { label: 'Wide 2:1', width: 2, height: 1 },
  landscape: { label: 'Landscape 3:2', width: 3, height: 2 },
  square: { label: 'Square', width: 1, height: 1 },
  portrait: { label: 'Portrait 2:3', width: 2, height: 3 },
} as const;
type Shape = keyof typeof SHAPES;

/** Shown inside a world that has no map yet. */
export function MapSetup() {
  const input = useRef<HTMLInputElement>(null);
  const [shape, setShape] = useState<Shape>('landscape');
  const [busy, setBusy] = useState<'image' | 'blank' | null>(null);

  const fromImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy('image');
    const r = await setupMap({ kind: 'image', file });
    setBusy(null);
    if (!r.ok) void alertDialog({ title: 'Could not use this image', body: r.reason });
  };

  const blank = async () => {
    setBusy('blank');
    const s = SHAPES[shape];
    const r = await setupMap({ kind: 'blank', width: s.width, height: s.height });
    setBusy(null);
    if (!r.ok) void alertDialog({ title: 'Could not set up the map', body: r.reason });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl animate-rise px-6 py-12">
        <p className="label-caps text-accent">Map</p>
        <h1 className="mt-2 text-5xl">Set up the map</h1>
        <p className="mt-3 text-muted">
          The map is a grid of cells, {GRID_LONG_SIDE} on its long side. You paint land and ocean, then biomes and elevation, and the app draws the map from what you paint. It
          starts as open ocean, with a list of basic biomes you can change.
        </p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void fromImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col p-6">
            <ImagePlus className="size-7 text-navy" />
            <h2 className="mt-3 text-2xl">From an image</h2>
            <p className="mt-2 flex-1 text-sm text-muted">
              Your map image (for example from Nortantis) goes under the app's map, so you can trace over it. The grid takes the image's shape. You can replace the image or remove it
              later; what you painted stays.
            </p>
            <Button variant="primary" className="mt-5 self-start" loading={busy === 'image'} disabled={busy !== null} onClick={() => input.current?.click()}>
              Choose image
            </Button>
          </Card>
          <Card className="flex flex-col p-6">
            <MapIcon className="size-7 text-navy" />
            <h2 className="mt-3 text-2xl">Blank</h2>
            <p className="mt-2 text-sm text-muted">No image: paint the map from nothing. Choose its shape.</p>
            <Segmented<Shape>
              className="mt-4 self-start"
              size="sm"
              value={shape}
              onChange={setShape}
              options={(Object.keys(SHAPES) as Shape[]).map((k) => ({ value: k, label: SHAPES[k].label }))}
            />
            <div className="flex-1" />
            <Button variant="primary" className="mt-5 self-start" loading={busy === 'blank'} disabled={busy !== null} onClick={() => void blank()}>
              Create blank map
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
