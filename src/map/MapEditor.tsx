import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Hand, Maximize, PaintBucket, Paintbrush, Redo2, Undo2 } from 'lucide-react';
import { Kbd, Segmented, cx } from '../components/ui';
import { emitMap, getMap, mapEdited } from '../lib/store';
import { LandPainter, type Brush } from '../lib/map/paint';
import type { Graph } from '../lib/map/graph';
import type { MapInfo } from '../lib/world/types';
import { MapCanvas, type Hover, type MapCanvasHandle, type Tool } from './MapCanvas';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

/** Formats a brush size in km: whole km above 10, one decimal below. */
const kmShort = (n: number) => (n >= 10 ? `${Math.round(n).toLocaleString()} km` : `${n.toFixed(1)} km`);

/** The map work area: toolbar on top, the map in the middle, a readout at the bottom. */
export function MapEditor({ map, graph }: { map: MapInfo; graph: Graph }) {
  const painter = useMemo(() => new LandPainter(getMap, () => emitMap('land'), mapEdited), []);
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

  // Brush size: a slider from about half a cell to a fifth of the map's short side, on a curve so small sizes get room.
  const minR = graph.spacing * 0.5;
  const maxR = Math.min(map.width, map.height) / 5;
  const [sizeStep, setSizeStep] = useState(35);
  const radius = minR * Math.pow(maxR / minR, sizeStep / 100);

  const [tool, setTool] = useState<Tool>('brush');
  const [land, setLand] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(1);

  const brush: Brush = useMemo(() => ({ land, radius }), [land, radius]);

  const pick = useCallback((h: Hover) => setLand(h.land), []);

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
      else if (k === 'x') setLand((v) => !v);
      else if (e.key === '[') setSizeStep((s) => Math.max(0, s - 6));
      else if (e.key === ']') setSizeStep((s) => Math.min(100, s + 6));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [painter]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-3 py-2">
        <Segmented<'land' | 'water'>
          value={land ? 'land' : 'water'}
          onChange={(v) => setLand(v === 'land')}
          size="sm"
          options={[
            { value: 'land', label: 'Land', title: 'Paint land (X swaps)' },
            { value: 'water', label: 'Water', title: 'Paint water (X swaps)' },
          ]}
        />
        <div className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-0.5">
          <ToolButton label="Brush (B)" active={tool === 'brush'} onClick={() => setTool('brush')}>
            <Paintbrush className="size-4" />
          </ToolButton>
          <ToolButton label="Fill (F): fills the connected land or water you click" active={tool === 'fill'} onClick={() => setTool('fill')}>
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
            className="slider w-32"
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
        <MapCanvas handle={canvas} graph={graph} seed={map.seed} brush={brush} tool={tool} painter={painter} onHover={setHover} onPick={pick} onZoom={setZoom} />
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
          </span>
        ) : (
          <span>Point at the map to read a position. Kilometers are measured from the top-left corner.</span>
        )}
        <div className="flex-1" />
        <span className="hidden items-center gap-1 lg:flex">
          <Kbd>Alt</Kbd>+click picks land or water
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
