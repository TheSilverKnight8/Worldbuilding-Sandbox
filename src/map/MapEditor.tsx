import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Hand, Maximize, PaintBucket, Paintbrush, Redo2, Undo2 } from 'lucide-react';
import { Input, Kbd, Segmented, cx } from '../components/ui';
import { emitLayers, getLayers, layersEdited } from '../lib/store';
import { biomeFields, palette as buildPalette } from '../lib/map/biomes';
import { ELEVATION_MAX, ELEVATION_MIN, isLand } from '../lib/map/grid';
import { Painter, type Brush, type ElevationOp, type PaintMode } from '../lib/map/paint';
import type { MapInfo, WorldDoc } from '../lib/world/types';
import { MapCanvas, type Hover, type LayerSettings, type MapCanvasHandle, type Tool } from './MapCanvas';
import { MapPanels } from './MapPanels';

const MAX_RADIUS = 64;

const meters = (n: number) => `${n.toLocaleString()} m`;

/** The map work area: toolbar on top, the map in the middle, panels on the right, readout at the bottom. */
export function MapEditor({ world, map }: { world: WorldDoc; map: MapInfo }) {
  const painter = useMemo(() => new Painter(getLayers, emitLayers, layersEdited), []);
  const canUndo = useSyncExternalStore(
    (fn) => painter.subscribe(fn),
    () => painter.canUndo,
  );
  const canRedo = useSyncExternalStore(
    (fn) => painter.subscribe(fn),
    () => painter.canRedo,
  );
  const canvas = useRef<MapCanvasHandle>(null);

  const [mode, setMode] = useState<PaintMode>('land');
  const [tool, setTool] = useState<Tool>('brush');
  const [radius, setRadius] = useState(8);
  const [land, setLand] = useState<'land' | 'ocean'>('land');
  const [biomeId, setBiomeId] = useState<string | null>(null);
  const [elevationOp, setElevationOp] = useState<ElevationOp>('raise');
  const [elevationValue, setElevationValue] = useState(500);
  const [elevationStep, setElevationStep] = useState(50);
  const [layers, setLayers] = useState<LayerSettings>(() => ({
    backdrop: true,
    backdropOpacity: 1,
    map: true,
    // With an image underneath, the app's map starts half see-through so the image shows for tracing.
    mapOpacity: map.backdrop ? 0.5 : 1,
    biomes: true,
    relief: true,
  }));
  const [hover, setHover] = useState<Hover>(null);
  const [zoom, setZoom] = useState(1);

  // Removing the image makes the app's map fully opaque; adding one makes it half see-through again for tracing.
  const hadBackdrop = useRef(!!map.backdrop);
  useEffect(() => {
    const has = !!map.backdrop;
    if (has !== hadBackdrop.current) setLayers((l) => ({ ...l, backdrop: true, mapOpacity: has ? 0.5 : 1 }));
    hadBackdrop.current = has;
  }, [map.backdrop]);

  const biome = biomeId ? world.records[biomeId] : undefined;
  // A deleted biome stops being selected.
  useEffect(() => {
    if (biomeId && !world.records[biomeId]) setBiomeId(null);
  }, [biomeId, world.records]);

  const brush: Brush = useMemo(
    () => ({
      mode,
      radius,
      land,
      biomeSlot: biome ? Math.max(0, map.biomeSlots.indexOf(biome.id)) : 0,
      biomeRealm: biome ? biomeFields(biome).realm : null,
      elevationOp,
      elevationValue,
      elevationStep,
    }),
    [mode, radius, land, biome, map.biomeSlots, elevationOp, elevationValue, elevationStep],
  );

  const palette = useMemo(() => buildPalette(world, map), [world, map]);

  // Fill has nothing to do in Elevation mode.
  useEffect(() => {
    if (mode === 'elevation' && tool === 'fill') setTool('brush');
  }, [mode, tool]);

  const selectBiome = useCallback((id: string | null) => {
    setBiomeId(id);
    setMode('biome');
  }, []);

  const pick = (h: NonNullable<Hover>) => {
    if (mode === 'land') setLand(isLand(h.elevation) ? 'land' : 'ocean');
    else if (mode === 'biome') setBiomeId(map.biomeSlots[h.biomeSlot] ?? null);
    else {
      setElevationOp('set');
      setElevationValue(h.elevation);
    }
  };

  // Keyboard: B brush, F fill, H hand, [ and ] brush size, Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo.
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
      else if (k === 'f' && mode !== 'elevation') setTool('fill');
      else if (k === 'h') setTool('hand');
      else if (e.key === '[') setRadius((r) => Math.max(1, Math.round(r / 1.25)));
      else if (e.key === ']') setRadius((r) => Math.min(MAX_RADIUS, Math.max(r + 1, Math.round(r * 1.25))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [painter, mode]);

  const hoverBiome = hover && hover.biomeSlot ? world.records[map.biomeSlots[hover.biomeSlot] ?? ''] : undefined;
  const hoverBiomeFits = hoverBiome && hover && biomeFields(hoverBiome).realm === (isLand(hover.elevation) ? 'land' : 'ocean');

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
              { value: 'land', label: 'Land & ocean' },
              { value: 'biome', label: 'Biomes' },
              { value: 'elevation', label: 'Elevation' },
            ]}
          />
          <div className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-0.5">
            <ToolButton label="Brush (B)" active={tool === 'brush'} onClick={() => setTool('brush')}>
              <Paintbrush className="size-4" />
            </ToolButton>
            <ToolButton label={mode === 'elevation' ? 'Fill is for land, ocean and biomes' : 'Fill (F)'} active={tool === 'fill'} disabled={mode === 'elevation'} onClick={() => setTool('fill')}>
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
              min={1}
              max={MAX_RADIUS}
              value={radius}
              style={{ ['--fill' as string]: `${((radius - 1) / (MAX_RADIUS - 1)) * 100}%` }}
              onChange={(e) => setRadius(Number(e.target.value))}
            />
            <span className="w-6 font-mono text-xs text-ink">{radius}</span>
          </label>

          {mode === 'land' && (
            <Segmented<'land' | 'ocean'>
              value={land}
              onChange={setLand}
              size="sm"
              options={[
                { value: 'land', label: 'Land' },
                { value: 'ocean', label: 'Ocean' },
              ]}
            />
          )}
          {mode === 'biome' && (
            <span className="flex items-center gap-2 text-sm">
              {biome ? (
                <>
                  <span className="size-4 rounded border border-navy/20" style={{ background: biomeFields(biome).color }} />
                  <span className="font-medium">{biome.name}</span>
                  <span className="text-muted">paints only on {biomeFields(biome).realm}</span>
                </>
              ) : (
                <span className="text-muted">No biome: erases biomes. Pick a biome on the right.</span>
              )}
            </span>
          )}
          {mode === 'elevation' && (
            <>
              <Segmented<ElevationOp>
                value={elevationOp}
                onChange={setElevationOp}
                size="sm"
                options={[
                  { value: 'set', label: 'Set', title: 'Set cells to an exact elevation' },
                  { value: 'raise', label: 'Raise' },
                  { value: 'lower', label: 'Lower' },
                  { value: 'smooth', label: 'Smooth' },
                ]}
              />
              {elevationOp === 'set' && (
                <MetersInput label="Elevation" value={elevationValue} min={ELEVATION_MIN} max={ELEVATION_MAX} onChange={setElevationValue} />
              )}
              {(elevationOp === 'raise' || elevationOp === 'lower') && <MetersInput label="Per dab" value={elevationStep} min={1} max={2000} onChange={setElevationStep} />}
            </>
          )}

          <div className="flex-1" />
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
            width={map.width}
            height={map.height}
            backdrop={map.backdrop}
            palette={palette}
            brush={brush}
            tool={tool}
            layers={layers}
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
              <span className="font-mono text-muted">
                {hover.x}, {hover.y}
              </span>
              <span className="mx-2 text-line">|</span>
              {isLand(hover.elevation) ? 'Land' : 'Ocean'}, {meters(hover.elevation)}
              <span className="mx-2 text-line">|</span>
              {hoverBiomeFits && hoverBiome ? hoverBiome.name : 'No biome'}
            </span>
          ) : (
            <span>Point at the map to read a cell.</span>
          )}
          <div className="flex-1" />
          <span className="hidden items-center gap-1 lg:flex">
            <Kbd>Alt</Kbd>+click picks from the map
            <span className="mx-1 text-line">·</span>
            <Kbd>Space</Kbd>+drag moves
            <span className="mx-1 text-line">·</span>
            Wheel zooms
          </span>
          <span className="w-16 text-right font-mono">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      <MapPanels world={world} map={map} layers={layers} onLayers={setLayers} selectedBiome={biomeId} onSelectBiome={selectBiome} biomeMode={mode === 'biome'} />
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

/** A meters field that keeps what is typed until it is a whole number in range. */
function MetersInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (t: string) => {
    const n = Math.round(Number(t));
    if (t.trim() === '' || !Number.isFinite(n)) return setText(String(value));
    const v = Math.max(min, Math.min(max, n));
    onChange(v);
    setText(String(v));
  };
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <span className="relative">
        <Input
          type="number"
          value={text}
          min={min}
          max={max}
          step={10}
          className="h-8 w-28 pr-7 font-mono text-sm"
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs">m</span>
      </span>
    </label>
  );
}
