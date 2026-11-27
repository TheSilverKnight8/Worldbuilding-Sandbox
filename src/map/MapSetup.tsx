import { useRef, useState } from 'react';
import { Map as MapIcon, Shuffle } from 'lucide-react';
import { alertDialog } from '../components/dialogs';
import { Button, Card, Input, Segmented, cx } from '../components/ui';
import { DEFAULT_GEN, generateMap, type GenSettings, type LandShape } from '../lib/map/generate';
import { DEFAULT_CELLS, type Graph } from '../lib/map/graph';
import { variantsOf } from '../lib/map/icons';
import type { MapStyle } from '../lib/map/render';
import { newSeed } from '../lib/rng';
import { mapStyleFor } from '../lib/session';
import { checkMapSize, makeMapGraph, setupMap, useApp, type MapDraft } from '../lib/store';
import { MapPreview } from './MapPreview';

type Start = 'blank' | 'generate';

const SHAPES: { value: LandShape; label: string }[] = [
  { value: 'continent', label: 'One continent' },
  { value: 'continents', label: 'A few continents' },
  { value: 'islands', label: 'Islands' },
];
const MOUNTAIN_WORDS = ['Barely any', 'Low', 'Moderate', 'High', 'Very high'];
const CLIMATE_WORDS = ['Cold', 'Cool', 'Temperate', 'Warm', 'Hot'];
const word = (words: string[], v: number) => words[Math.min(words.length - 1, Math.floor(v * words.length))];

/** Shown inside a world that has no map yet: start blank, or generate a map and keep one. */
export function MapSetup() {
  const worldId = useApp((s) => (s.open.kind === 'ready' ? s.open.world.id : null));
  const [width, setWidth] = useState('4000');
  const [height, setHeight] = useState('3000');
  const [start, setStart] = useState<Start>('blank');
  const [settings, setSettings] = useState<GenSettings>(DEFAULT_GEN);
  const [draft, setDraft] = useState<MapDraft | null>(null);
  const [style, setStyle] = useState<MapStyle>('atlas');
  const [busy, setBusy] = useState<'create' | 'generate' | 'keep' | null>(null);
  // The polygons are made once per size; generating again reuses them.
  const polygons = useRef<{ key: string; graph: Graph; seed: number } | null>(null);
  const w = Number(width);
  const h = Number(height);
  const problem = width.trim() && height.trim() ? checkMapSize(w, h) : 'Enter a width and a height.';

  const setSize = (set: (v: string) => void) => (v: string) => {
    set(v);
    // A preview is for the size it was made at.
    setDraft(null);
  };

  const create = async () => {
    if (problem) return;
    setBusy('create');
    const r = await setupMap(w, h);
    setBusy(null);
    if (!r.ok) void alertDialog({ title: 'Could not set up the map', body: r.reason });
  };

  const generate = async () => {
    if (problem) return;
    setBusy('generate');
    // Let the button show that it is working before the heavy work starts.
    await new Promise((r) => window.setTimeout(r, 30));
    const key = `${w}x${h}`;
    if (polygons.current?.key !== key) {
      const seed = newSeed();
      polygons.current = { key, seed, graph: makeMapGraph(w, h, seed) };
    }
    const { graph, seed } = polygons.current;
    const generated = generateMap(graph, w, h, settings, newSeed(), variantsOf);
    setDraft({ widthKm: w, heightKm: h, graph, seed, generated });
    setBusy(null);
  };

  const keep = async () => {
    if (!draft) return;
    setBusy('keep');
    if (worldId) mapStyleFor(worldId).set(style);
    const r = await setupMap(draft.widthKm, draft.heightKm, draft);
    setBusy(null);
    if (!r.ok) void alertDialog({ title: 'Could not keep the map', body: r.reason });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className={cx('mx-auto animate-rise px-6 py-12', start === 'generate' ? 'max-w-6xl' : 'max-w-2xl')}>
        <p className="label-caps text-accent">Map</p>
        <h1 className="mt-2 text-5xl">Set up the map</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Give the map its real size. Start from open water and draw the land yourself, or let the app generate a map to edit. Either way the map is made of {DEFAULT_CELLS.toLocaleString()}{' '}
          irregular polygons, like Nortantis.
        </p>
        <Card className="mt-8 p-6">
          <MapIcon className="size-7 text-navy" />
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (start === 'blank' ? create() : generate());
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <SizeField label="Width" value={width} onChange={setSize(setWidth)} />
              <span className="pb-3 text-muted">×</span>
              <SizeField label="Height" value={height} onChange={setSize(setHeight)} />
            </div>
            <p className="mt-3 text-sm text-muted">{problem ?? `Area: ${Math.round(w * h).toLocaleString()} km²`}</p>
            <div className="mt-5 space-y-1.5">
              <span className="block text-sm font-medium">Start with</span>
              <Segmented<Start>
                value={start}
                onChange={setStart}
                options={[
                  { value: 'blank', label: 'Open water' },
                  { value: 'generate', label: 'A generated map' },
                ]}
              />
            </div>
            {start === 'blank' ? (
              <>
                <p className="mt-3 text-sm text-muted">The map starts as open water; you draw the land.</p>
                <Button type="submit" variant="primary" className="mt-5" loading={busy === 'create'} disabled={!!problem}>
                  {busy === 'create' ? 'Making the map' : 'Create map'}
                </Button>
              </>
            ) : (
              <div className="mt-6 grid gap-8 lg:grid-cols-[17rem_1fr]">
                <div className="space-y-5">
                  <Slider label="Amount of land" value={settings.land} min={0.1} max={0.7} step={0.05} shown={`${Math.round(settings.land * 100)}% land`} onChange={(v) => setSettings({ ...settings, land: v })} />
                  <div className="space-y-1.5">
                    <span className="block text-sm">Continents or islands</span>
                    <Segmented<LandShape> size="sm" value={settings.shape} onChange={(v) => setSettings({ ...settings, shape: v })} options={SHAPES} className="w-full" />
                  </div>
                  <Slider
                    label="How mountainous"
                    value={settings.mountains}
                    min={0}
                    max={1}
                    step={0.05}
                    shown={word(MOUNTAIN_WORDS, settings.mountains)}
                    ends={['Few, low ranges', 'Many, high ranges']}
                    onChange={(v) => setSettings({ ...settings, mountains: v })}
                  />
                  <Slider label="Climate" value={settings.climate} min={0} max={1} step={0.05} shown={word(CLIMATE_WORDS, settings.climate)} ends={['Cold', 'Hot']} onChange={(v) => setSettings({ ...settings, climate: v })} />
                  <p className="text-xs text-muted">The north of the map is colder than the south. Mountains, hills, volcanoes, plateaus and cliffs are placed as if by hand, so each can be moved, resized or deleted.</p>
                  <Button type="submit" variant={draft ? 'secondary' : 'primary'} loading={busy === 'generate'} disabled={!!problem || busy !== null}>
                    <Shuffle className="size-4" />
                    {draft ? 'Generate again' : 'Generate'}
                  </Button>
                </div>
                <div className="min-w-0">
                  <div className="overflow-hidden rounded-xl border border-line bg-raised" style={{ aspectRatio: `${w > 0 && h > 0 ? w / h : 4 / 3}` }}>
                    {draft ? (
                      <MapPreview graph={draft.graph} seed={draft.seed} generated={draft.generated} style={style} />
                    ) : (
                      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">{busy === 'generate' ? 'Generating…' : 'Generate a map to see it here. Generate again as often as you like, then keep the one you want.'}</div>
                    )}
                  </div>
                  {draft && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <Segmented<MapStyle>
                        size="sm"
                        value={style}
                        onChange={setStyle}
                        options={[
                          { value: 'atlas', label: 'Atlas' },
                          { value: 'painterly', label: 'Painterly' },
                        ]}
                      />
                      <Button type="button" variant="primary" loading={busy === 'keep'} disabled={busy !== null} onClick={() => void keep()}>
                        Keep this map
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, shown, ends, onChange }: { label: string; value: number; min: number; max: number; step: number; shown: string; ends?: [string, string]; onChange: (v: number) => void }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-sm">
        {label}
        <span className="font-mono text-xs text-muted">{shown}</span>
      </span>
      <input type="range" className="slider w-full" min={min} max={max} step={step} value={value} aria-label={label} style={{ ['--fill' as string]: `${fill}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      {ends && (
        <span className="flex justify-between text-[0.6875rem] text-muted">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </span>
      )}
    </label>
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
