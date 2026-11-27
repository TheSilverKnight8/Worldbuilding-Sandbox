import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Hand, Layers, Maximize, PaintBucket, Paintbrush, Redo2, Undo2 } from 'lucide-react';
import { Input, Kbd, Segmented, cx } from '../components/ui';
import { emitMap, getMap, mapEdited, setPlacedIcons } from '../lib/store';
import { mapStyleFor } from '../lib/session';
import { newId } from '../lib/ids';
import { biomeFields, slotLooks, type SlotLook } from '../lib/map/biomes';
import type { Graph } from '../lib/map/graph';
import { MapPainter, type Brush, type ElevationOp, type PaintMode } from '../lib/map/paint';
import { OVERLAY, type MapStyle } from '../lib/map/render';
import { variantsOf, type Placement } from '../lib/map/icons';
import { ELEVATION_MAX, KINDS } from '../lib/map/terrain';
import type { IconKind, MapInfo, PlacedIcon, WorldDoc } from '../lib/world/types';
import { BiomePanel } from './BiomePanel';
import { IconsPanel, type IconSettings } from './IconsPanel';
import { MapCanvas, type Hover, type IconTool, type MapCanvasHandle, type Tool } from './MapCanvas';

type Mode = PaintMode | 'icons';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;
/** A size in km: whole km above 10, one decimal below. */
const kmShort = (n: number) => (n >= 10 ? `${Math.round(n).toLocaleString()} km` : `${n.toFixed(1)} km`);

/** The map work area: toolbar on top, the map in the middle with a panel beside it, a readout at the bottom. */
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
  const [overlay, setOverlay] = useState(false);

  // Brush size: a slider from about half a cell to a fifth of the map's short side, on a curve so small sizes get room.
  const minR = graph.spacing * 0.5;
  const maxR = Math.min(map.width, map.height) / 5;
  const [sizeStep, setSizeStep] = useState(35);
  const radius = minR * Math.pow(maxR / minR, sizeStep / 100);

  const [mode, setMode] = useState<Mode>('land');
  const [tool, setTool] = useState<Tool>('brush');
  const [land, setLand] = useState(true);
  const [biomeId, setBiomeId] = useState<string | null>(null);
  const [op, setOp] = useState<ElevationOp>('raise');
  const [setMeters, setSetMeters] = useState(1000);
  const [stepMeters, setStepMeters] = useState(150);
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
  const brush: Brush = useMemo(
    () => ({ mode: mode === 'icons' ? 'land' : mode, land, biomeSlot, op, meters: op === 'set' ? setMeters : stepMeters, radius }),
    [mode, land, biomeSlot, op, setMeters, stepMeters, radius],
  );

  // ------------------------------------------------------------ icons placed by hand

  const defaults = useCallback(
    (k: IconKind): IconSettings => ({
      sizeKm: KINDS[k].size * graph.spacing * kmPerUnit,
      meters: KINDS[k].meters?.value,
      angle: KINDS[k].rotatable ? 180 : undefined,
      shape: k === 'cliff' ? 'even' : undefined,
    }),
    [graph.spacing, kmPerUnit],
  );
  const [iconKind, setIconKind] = useState<IconKind>('mountain');
  const [iconSettings, setIconSettings] = useState<IconSettings>(() => defaults('mountain'));
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [iconTool, setIconTool] = useState<IconTool>('place');
  const selected = selectedIcon ? (map.icons.find((i) => i.id === selectedIcon) ?? null) : null;
  useEffect(() => {
    if (selectedIcon && !selected) setSelectedIcon(null);
  }, [selectedIcon, selected]);
  useEffect(() => {
    if (mode !== 'icons') setSelectedIcon(null);
  }, [mode]);

  /** Changes the placed icons (and the app's icons taken over, if given) and adds the change to the undo history. */
  const changeIcons = useCallback(
    (next: PlacedIcon[], key?: string, nextHidden?: string[]) => {
      const before = map.icons;
      const hiddenBefore = map.hiddenAuto;
      const hiddenAfter = nextHidden ?? map.hiddenAuto;
      setPlacedIcons(next, hiddenAfter);
      painter.push({ undo: () => setPlacedIcons(before, hiddenBefore), redo: () => setPlacedIcons(next, hiddenAfter), key });
    },
    [map.icons, map.hiddenAuto, painter],
  );

  const placeIcon = useCallback(
    (x: number, y: number) => {
      const icon: PlacedIcon = { id: newId(), kind: iconKind, x, y, size: Math.max(0.05, iconSettings.sizeKm / kmPerUnit), variant: Math.floor(Math.random() * variantsOf(iconKind)) };
      if (iconSettings.meters !== undefined && KINDS[iconKind].meters) icon.meters = iconSettings.meters;
      if (KINDS[iconKind].rotatable) icon.angle = iconSettings.angle ?? 180;
      if (iconKind === 'cliff') icon.shape = iconSettings.shape ?? 'even';
      changeIcons([...map.icons, icon]);
      setSelectedIcon(icon.id);
    },
    [iconKind, iconSettings, kmPerUnit, map.icons, changeIcons],
  );

  /** Takes over an icon the app drew by itself: it becomes an icon placed by hand, in the same spot, and the app's copy is left out. */
  const adoptIcon = useCallback(
    (p: Placement, meters: number) => {
      const icon: PlacedIcon = { id: newId(), kind: p.set, x: p.x, y: p.y, size: p.size, variant: p.variant };
      // A hill or mountain keeps the height of the ground it stood on, so taking it over does not raise the land.
      if (KINDS[p.set].meters) icon.meters = Math.max(1, Math.round(meters));
      changeIcons([...map.icons, icon], undefined, p.auto ? [...map.hiddenAuto, p.auto] : undefined);
      return icon.id;
    },
    [map.icons, map.hiddenAuto, changeIcons],
  );

  const moveIcon = useCallback((id: string, x: number, y: number) => changeIcons(map.icons.map((i) => (i.id === id ? { ...i, x, y } : i))), [map.icons, changeIcons]);

  const deleteSelected = useCallback(() => {
    if (!selectedIcon) return;
    changeIcons(map.icons.filter((i) => i.id !== selectedIcon));
    setSelectedIcon(null);
  }, [selectedIcon, map.icons, changeIcons]);

  const selectedSettings: IconSettings | null = selected
    ? { sizeKm: selected.size * kmPerUnit, meters: selected.meters ?? KINDS[selected.kind].meters?.value, angle: selected.angle ?? (KINDS[selected.kind].rotatable ? 180 : undefined), shape: selected.shape }
    : null;
  const editSelected = (s: IconSettings) => {
    if (!selected) return;
    const next: PlacedIcon = { ...selected, size: Math.max(0.05, s.sizeKm / kmPerUnit) };
    if (KINDS[selected.kind].meters && s.meters !== undefined) next.meters = s.meters;
    if (KINDS[selected.kind].rotatable) next.angle = s.angle ?? 180;
    if (selected.kind === 'cliff') next.shape = s.shape ?? 'even';
    changeIcons(
      map.icons.map((i) => (i.id === selected.id ? next : i)),
      `edit ${selected.id}`,
    );
  };

  // ------------------------------------------------------------ picking and keys

  const selectBiome = useCallback((id: string | null) => {
    setBiomeId(id);
    setMode('biome');
  }, []);

  const pick = useCallback(
    (h: Hover) => {
      if (mode === 'land') setLand(h.land);
      else if (mode === 'biome' && h.land) setBiomeId(map.biomeSlots[h.biomeSlot] ?? null);
      else if (mode === 'elevation' && h.land) {
        setOp('set');
        setSetMeters(h.elevation);
      }
    },
    [mode, map.biomeSlots],
  );

  // Keyboard: B brush, F fill, H hand, X swaps land and water, [ and ] brush size, Ctrl+Z undo,
  // Ctrl+Shift+Z or Ctrl+Y redo; in Icons mode Delete removes the selected icon and Escape lets go of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a field are the field's (sliders, checkboxes and buttons do not take typing).
      if (e.target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(e.target.type)) return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
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
      else if (mode === 'icons' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') setSelectedIcon(null);
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
  }, [painter, mode, deleteSelected]);

  // Fill has nothing to do in Elevation mode.
  useEffect(() => {
    if (mode === 'elevation' && tool === 'fill') setTool('brush');
  }, [mode, tool]);

  const biome = biomeId ? world.records[biomeId] : undefined;
  const hoverBiome = hover && hover.land && hover.biomeSlot ? world.records[map.biomeSlots[hover.biomeSlot] ?? ''] : undefined;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        {/* One row at a fixed height, so the map never moves when the mode changes (it scrolls sideways if the window is too narrow). */}
        <div className="scrollbar-thin flex h-12 shrink-0 items-center gap-4 overflow-x-auto overflow-y-hidden border-b border-line bg-surface px-3 whitespace-nowrap [&>*]:shrink-0">
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            size="sm"
            options={[
              { value: 'land', label: 'Land & water' },
              { value: 'biome', label: 'Biomes' },
              { value: 'elevation', label: 'Elevation' },
              { value: 'icons', label: 'Icons' },
            ]}
          />
          {mode === 'land' && (
            <Segmented<'land' | 'water'>
              value={land ? 'land' : 'water'}
              onChange={(v) => setLand(v === 'land')}
              size="sm"
              options={[
                { value: 'land', label: 'Land', title: 'Paint land (X swaps)' },
                { value: 'water', label: 'Water', title: 'Paint water (X swaps)' },
              ]}
            />
          )}
          {mode === 'biome' && (
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
          {mode === 'elevation' && (
            <>
              <Segmented<ElevationOp>
                value={op}
                onChange={setOp}
                size="sm"
                options={[
                  { value: 'set', label: 'Set', title: 'Set land to an exact height' },
                  { value: 'raise', label: 'Raise' },
                  { value: 'lower', label: 'Lower' },
                  { value: 'smooth', label: 'Smooth' },
                ]}
              />
              {op === 'set' && <MetersInput label="Height" value={setMeters} min={0} max={ELEVATION_MAX} onChange={setSetMeters} />}
              {(op === 'raise' || op === 'lower') && <MetersInput label="Per dab" value={stepMeters} min={1} max={3000} onChange={setStepMeters} />}
            </>
          )}
          {mode === 'icons' ? (
            <>
              <Segmented<IconTool>
                value={iconTool}
                onChange={setIconTool}
                size="sm"
                options={[
                  { value: 'place', label: 'Place', title: 'Click the map to place an icon; click one you placed to select it' },
                  { value: 'select', label: 'Select', title: 'Click any icon to select it, the ones the app drew included' },
                ]}
              />
              <span className="text-sm text-muted">{iconTool === 'place' ? 'Click to place; drag an icon you placed to move it.' : 'Click any icon to select, move or resize it.'}</span>
            </>
          ) : (
            <>
              <div className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-0.5">
                <ToolButton label="Brush (B)" active={tool === 'brush'} onClick={() => setTool('brush')}>
                  <Paintbrush className="size-4" />
                </ToolButton>
                <ToolButton label={mode === 'elevation' ? 'Fill is for land, water and biomes' : 'Fill (F): fills the connected area you click'} active={tool === 'fill'} disabled={mode === 'elevation'} onClick={() => setTool('fill')}>
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
                  className="slider w-24"
                  min={0}
                  max={100}
                  value={sizeStep}
                  aria-label="Brush size"
                  style={{ ['--fill' as string]: `${sizeStep}%` }}
                  onChange={(e) => setSizeStep(Number(e.target.value))}
                />
                <span className="w-16 font-mono text-xs text-ink">{kmShort(radius * 2 * kmPerUnit)}</span>
              </label>
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
            placed={map.icons}
            hiddenAuto={map.hiddenAuto}
            overlay={overlay}
            iconMode={mode === 'icons'}
            iconTool={iconTool}
            selectedIcon={selectedIcon}
            brush={brush}
            tool={mode === 'icons' ? 'brush' : tool}
            painter={painter}
            onHover={setHover}
            onPick={pick}
            onZoom={setZoom}
            onPlaceIcon={placeIcon}
            onSelectIcon={setSelectedIcon}
            onMoveIcon={moveIcon}
            onAdoptIcon={adoptIcon}
          />
          {/* How the map is shown, over its top-right corner. */}
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-xl border border-line bg-surface/95 p-1 shadow-card">
            <button
              type="button"
              aria-pressed={overlay}
              title="Elevation overlay: colors by height and contour lines"
              onClick={() => setOverlay((v) => !v)}
              className={cx('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition', overlay ? 'border-navy bg-navy text-on-accent' : 'border-line bg-raised text-muted hover:text-ink')}
            >
              <Layers className="size-4" />
              Elevation
            </button>
            <Segmented<MapStyle>
              value={style}
              onChange={setStyle}
              size="sm"
              options={[
                { value: 'atlas', label: 'Atlas', title: 'Fantasy atlas, in ink' },
                { value: 'painterly', label: 'Painterly', title: 'Colorful painted map' },
              ]}
            />
            <ToolButton label="Fit the map in the window" onClick={() => canvas.current?.fit()}>
              <Maximize className="size-4" />
            </ToolButton>
          </div>
          {overlay && <ElevationKey />}
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
                  <span className="font-mono">{hover.elevation.toLocaleString()} m</span>
                  <span className="mx-2 text-line">|</span>
                  {hoverBiome ? hoverBiome.name : 'No biome'}
                </>
              )}
            </span>
          ) : (
            <span>Point at the map to read a position. Kilometers are measured from the top-left corner.</span>
          )}
          <div className="flex-1" />
          <span className="hidden items-center gap-1 2xl:flex">
            <Kbd>Alt</Kbd>+click picks from the map
            <span className="mx-1 text-line">·</span>
            <Kbd>Space</Kbd>+drag moves
          </span>
          <span className="font-mono" title="The map's size">
            {km(map.widthKm)} × {km(map.heightKm)}
          </span>
          <span className="w-14 text-right font-mono">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {mode === 'icons' ? (
        <IconsPanel
          kind={iconKind}
          onKind={(k) => {
            setIconKind(k);
            setIconSettings(defaults(k));
            setSelectedIcon(null);
          }}
          settings={iconSettings}
          onSettings={setIconSettings}
          selected={selected}
          selectedSettings={selectedSettings}
          onSelectedSettings={editSelected}
          onDelete={deleteSelected}
          onDeselect={() => setSelectedIcon(null)}
        />
      ) : (
        <BiomePanel world={world} map={map} selected={biomeId} onSelect={selectBiome} active={mode === 'biome'} />
      )}
    </div>
  );
}

/** The key to the elevation overlay's colors, in the map's corner. */
function ElevationKey() {
  const top = OVERLAY.stops[OVERLAY.stops.length - 1][0];
  const gradient = `linear-gradient(to right, ${OVERLAY.stops.map(([h, c]) => `${c} ${(h / top) * 100}%`).join(', ')})`;
  const ticks = [0, 1000, 2500, 5000];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 w-60 rounded-lg border border-line bg-surface/95 px-3 py-2 shadow-card" data-testid="elevation-key">
      <div className="label-caps mb-1.5 text-[0.6875rem] text-muted">Elevation</div>
      <div className="h-2.5 rounded-sm border border-line" style={{ background: gradient }} />
      <div className="relative mt-1 h-3.5 font-mono text-[0.625rem] text-muted">
        {ticks.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full" style={{ left: `${(h / top) * 100}%` }}>
            {h === top ? `${h.toLocaleString()}+ m` : h.toLocaleString()}
          </span>
        ))}
      </div>
      <div className="mt-1 text-[0.625rem] text-muted">
        Lines every {OVERLAY.contour} m, heavier every {OVERLAY.contourMajor.toLocaleString()} m
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
          step={50}
          aria-label={label}
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
