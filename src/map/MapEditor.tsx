import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Hand, Maximize, PaintBucket, Paintbrush, Redo2, Undo2 } from 'lucide-react';
import { Kbd, Segmented, cx } from '../components/ui';
import { emitMap, getMap, mapEdited } from '../lib/store';
import { mapStyleFor } from '../lib/session';
import { biomeFields, slotLooks, type SlotLook } from '../lib/map/biomes';
import type { Graph } from '../lib/map/graph';
import { MapPainter, type Brush, type PaintMode } from '../lib/map/paint';
import type { MapStyle } from '../lib/map/render';
import type { MapInfo, WorldDoc } from '../lib/world/types';
import { BiomePanel } from './BiomePanel';
import { MapCanvas, type Hover, type MapCanvasHandle, type Tool } from './MapCanvas';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;
/** A brush size in km: whole km above 10, one decimal below. */
const kmShort = (n: number) => (n >= 10 ? `${Math.round(n).toLocaleString()} km` : `${n.toFixed(1)} km`);

/** The map work area: toolbar on top, the map in the middle with the biome panel beside it, a readout at the bottom. */
export function MapEditor({ world, map, graph }: { world: WorldDoc; map: MapInfo; graph: Graph }) {
  const painter = useMemo(() => new MapPainter(getMap, (what) => emitMap(what), mapEdited), []);
  const canUndo = useSyncExternalStore(
    (fn) => painter.subscribe(fn),
    () => painter.canUndo,
  );
  const canRedo = useSyncExternalStore(
    (fn) => painter.subscribe(fn),
    () => painter.canRedo,
  );
  const canvas = useRef<MapCanvasHandle>(null);
  const kmPerUnit = map.widthKm / map.width;

  // The look, remembered per world on this computer.
  const [style, setStyleState] = useState<MapStyle>(() => (mapStyleFor(world.id).get() === 'painterly' ? 'painterly' : 'atlas'));
  const setStyle = (s: MapStyle) => {
    setStyleState(s);
    mapStyleFor(world.id).set(s);
  };

  // Brush size: a slider from about half a cell to a fifth of the map's short side, on a curve so small sizes get room.
  const minR = graph.spacing * 0.5;
  const maxR = Math.min(map.width, map.height) / 5;
  const [sizeStep, setSizeStep] = useState(35);
  const radius = minR * Math.pow(maxR / minR, sizeStep / 100);

  const [mode, setMode] = useState<PaintMode>('land');
  const [tool, setTool] = useState<Tool>('brush');
  const [land, setLand] = useState(true);
  const [biomeId, setBiomeId] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(1);

  // A deleted biome stops being selected.
  useEffect(() => {
    if (biomeId && !world.records[biomeId]) setBiomeId(null);
  }, [biomeId, world.records]);

  // What each biome slot looks like. Kept as the same object until a color or icon set really changes, so the map is not redrawn for nothing.
  const looksKey = JSON.stringify(slotLooks(world, map));
  const looks = useMemo(() => JSON.parse(looksKey) as (SlotLook | null)[], [looksKey]);

  const biomeSlot = biomeId ? Math.max(0, map.biomeSlots.indexOf(biomeId)) : 0;
  const brush: Brush = useMemo(() => ({ mode, land, biomeSlot, radius }), [mode, land, biomeSlot, radius]);

  const selectBiome = useCallback((id: string | null) => {
    setBiomeId(id);
    setMode('biome');
  }, []);

  const pick = useCallback(
    (h: Hover) => {
      if (mode === 'land') setLand(h.land);
      else if (h.land) setBiomeId(map.biomeSlots[h.biomeSlot] ?? null);
    },
    [mode, map.biomeSlots],
  );

  // Keyboard: B brush, F fill, H hand, X swaps land and water, [ and ] brush size, Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) painter.redo();
        else painter.undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        painter.redo();
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (k === 'b') setTool('brush');
      else if (k === 'f') setTool('fill');
      else if (k === 'h') setTool('hand');
      else if (k === 'x') {
        setMode('land');
        setLand((v) => !v);
      } else if (e.key === '[') setSizeStep((s) => Math.max(0, s - 6));
      else if (e.key === ']') setSizeStep((s) => Math.min(100, s + 6));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [painter]);

  const biome = biomeId ? world.records[biomeId] : undefined;
  const hoverBiome = hover && hover.land && hover.biomeSlot ? world.records[map.biomeSlots[hover.biomeSlot] ?? ''] : undefined;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2">
          <Segmented<PaintMode>
            value={mode}
            onChange={setMode}
            size="sm"
            options={[
              { value: 'land', label: 'Land & water' },
              { value: 'biome', label: 'Biomes' },
            ]}
          />
          {mode === 'land' ? (
            <Segmented<'land' | 'water'>
              value={land ? 'land' : 'water'}
              onChange={(v) => setLand(v === 'land')}
              size="sm"
              options={[
                { value: 'land', label: 'Land', title: 'Paint land (X swaps)' },
                { value: 'water', label: 'Water', title: 'Paint water (X swaps)' },
              ]}
            />
          ) : (
            <span className="flex items-center gap-2 text-sm">
              {biome ? (
                <>
                  <span className="size-4 rounded border border-navy/20" style={{ background: biomeFields(biome).color }} />
                  <span className="font-medium">{biome.name}</span>
                  <span className="text-muted">on land only</span>
                </>
              ) : (
                <span className="text-muted">No biome: erases biomes. Pick one on the right.</span>
              )}
            </span>
          )}
          <div className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-0.5">
            <ToolButton label="Brush (B)" active={tool === 'brush'} onClick={() => setTool('brush')}>
              <Paintbrush className="size-4" />
            </ToolButton>
            <ToolButton label="Fill (F): fills the connected area you click" active={tool === 'fill'} onClick={() => setTool('fill')}>
              <PaintBucket className="size-4" />
            </ToolButton>
            <ToolButton label="Move the map (H, or hold Space)" active={tool === 'hand'} onClick={() => setTool('hand')}>
              <Hand className="size-4" />
            </ToolButton>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted" title="Brush size: [ and ]">
            Size
            <input
              type="range"
              className="slider w-28"
              min={0}
              max={100}
              value={sizeStep}
              aria-label="Brush size"
              style={{ ['--fill' as string]: `${sizeStep}%` }}
              onChange={(e) => setSizeStep(Number(e.target.value))}
            />
            <span className="w-16 font-mono text-xs text-ink">{kmShort(radius * 2 * kmPerUnit)}</span>
          </label>
          <div className="flex-1" />
          <Segmented<MapStyle>
            value={style}
            onChange={setStyle}
            size="sm"
            options={[
              { value: 'atlas', label: 'Atlas', title: 'Fantasy atlas, in ink' },
              { value: 'painterly', label: 'Painterly', title: 'Colorful painted map' },
            ]}
          />
          <div className="flex items-center gap-0.5">
            <ToolButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => painter.undo()}>
              <Undo2 className="size-4" />
            </ToolButton>
            <ToolButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => painter.redo()}>
              <Redo2 className="size-4" />
            </ToolButton>
            <ToolButton label="Fit the map in the window" onClick={() => canvas.current?.fit()}>
              <Maximize className="size-4" />
            </ToolButton>
          </div>
        </div>

        {/* The map */}
        <div className="relative min-h-0 flex-1 bg-raised">
          <MapCanvas
            handle={canvas}
            graph={graph}
            seed={map.seed}
            style={style}
            looks={looks}
            brush={brush}
            tool={tool}
            painter={painter}
            onHover={setHover}
            onPick={pick}
            onZoom={setZoom}
          />
        </div>

        {/* Readout */}
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-line bg-surface px-3 text-xs text-muted">
          {hover ? (
            <span className="text-ink">
              <span className="font-mono">
                {km(hover.x * kmPerUnit)} E, {km(hover.y * kmPerUnit)} S
              </span>
              <span className="mx-2 text-line">|</span>
              {hover.land ? 'Land' : 'Water'}
              {hover.land && (
                <>
                  <span className="mx-2 text-line">|</span>
                  {hoverBiome ? hoverBiome.name : 'No biome'}
                </>
              )}
            </span>
          ) : (
            <span>Point at the map to read a position. Kilometers are measured from the top-left corner.</span>
          )}
          <div className="flex-1" />
          <span className="hidden items-center gap-1 xl:flex">
            <Kbd>Alt</Kbd>+click picks from the map
            <span className="mx-1 text-line">·</span>
            <Kbd>Space</Kbd>+drag moves
            <span className="mx-1 text-line">·</span>
            Wheel zooms
          </span>
          <span className="font-mono" title="The map's size">
            {km(map.widthKm)} × {km(map.heightKm)}
          </span>
          <span className="w-14 text-right font-mono">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      <BiomePanel world={world} map={map} selected={biomeId} onSelect={selectBiome} active={mode === 'biome'} />
    </div>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex size-8 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-35',
        active ? 'bg-navy text-on-accent shadow-card' : 'text-muted hover:bg-surface hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
