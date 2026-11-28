import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Hand, Layers, Maximize, PaintBucket, Paintbrush, Redo2, Undo2 } from 'lucide-react';
import { Input, Kbd, Segmented, cx } from '../components/ui';
import { addEntry, emitMap, getMap, mapEdited, setCliffs, setPlacedIcons, setRivers, setTexts } from '../lib/store';
import type { NodeTarget } from '../lib/map/nodes';
import type { EntryKind } from '../lib/world/entries';
import { NodesPanel } from './NodesPanel';
import { lookFor, onLookChange, setLook } from '../lib/session';
import { newId } from '../lib/ids';
import { biomeFields, slotLooks, type SlotLook } from '../lib/map/biomes';
import { cellAt, type Graph } from '../lib/map/graph';
import { MapPainter, type Brush, type ElevationOp, type PaintMode } from '../lib/map/paint';
import { OVERLAY, type MapStyle } from '../lib/map/render';
import { variantsOf, type Placement } from '../lib/map/icons';
import { cliffLength } from '../lib/map/cliffs';
import { defaultRiverWidth, riverLength } from '../lib/map/rivers';
import { DEFAULT_ROOF, ELEVATION_MAX, KINDS, SIZED_BY_POLYGON, footOffset, iconCell, polygonScale } from '../lib/map/terrain';
import { placedToPlacement } from '../lib/map/scene';
import type { Cliff, IconKind, MapInfo, MapText, PlacedIcon, River, TextKind, WorldDoc } from '../lib/world/types';
import { TEXT_STYLES } from '../lib/map/text';
import { TextPanel } from './TextPanel';
import { BiomePanel } from './BiomePanel';
import { IconsPanel, type IconSettings } from './IconsPanel';
import { CliffsPanel } from './CliffsPanel';
import { MapCanvas, type CliffTool, type Hover, type IconTool, type MapCanvasHandle, type RiverTool, type TextTool, type Tool } from './MapCanvas';
import { RiversPanel } from './RiversPanel';

type Mode = PaintMode | 'rivers' | 'cliffs' | 'icons' | 'text' | 'nodes';
/** Modes where clicks on the map draw, place or select instead of painting. */
const clicking = (m: Mode) => m === 'icons' || m === 'rivers' || m === 'cliffs' || m === 'text' || m === 'nodes';

const km = (n: number) => `${Math.round(n).toLocaleString()} km`;
/** A size in km: whole km above 10, one decimal below. */
const kmShort = (n: number) => (n >= 10 ? `${Math.round(n).toLocaleString()} km` : `${n.toFixed(1)} km`);

/** The map work area: toolbar on top, the map in the middle with a panel beside it, a readout at the bottom. */
/** The map editor. While `active` is false (the Entries view is shown instead) it stays as it was but takes no keys. */
export function MapEditor({ world, map, graph, active = true }: { world: WorldDoc; map: MapInfo; graph: Graph; active?: boolean }) {
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

  // The look, shared with the entry pages and remembered per world on this computer.
  const style: MapStyle = useSyncExternalStore(onLookChange, () => lookFor(world.id));
  const setStyle = (s: MapStyle) => setLook(world.id, s);
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
    () => ({ mode: clicking(mode) ? 'land' : mode, land, biomeSlot, op, meters: op === 'set' ? setMeters : stepMeters, radius }),
    [mode, land, biomeSlot, op, setMeters, stepMeters, radius],
  );

  // ------------------------------------------------------------ icons placed by hand

  const defaults = useCallback(
    (k: IconKind): IconSettings => ({
      sizeKm: KINDS[k].size * graph.spacing * kmPerUnit,
      meters: KINDS[k].meters?.value,
      angle: KINDS[k].directional ? 180 : undefined,
      color: KINDS[k].group === 'settlements' ? DEFAULT_ROOF : undefined,
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

  /**
   * Places an icon on the polygon clicked, as Nortantis does (Caleb): in the polygon's middle,
   * one per polygon. If the polygon already has an icon standing on it, one of the same kind
   * gets another drawing instead, and one of another kind is replaced. A polygon that a
   * neighbor's icon only reaches over is free: the icon in front is drawn on top.
   */
  const placeIcon = useCallback(
    (x: number, y: number) => {
      const c = cellAt(graph, x, y);
      if (c < 0) return;
      // The icon already standing on this polygon (the one in front, if there are several).
      let there: PlacedIcon | null = null;
      for (const i of map.icons) if (iconCell(graph, i) === c && (!there || i.y > there.y)) there = i;
      if (there && there.kind === iconKind) {
        const n = variantsOf(iconKind);
        const now = placedToPlacement(there).variant;
        const variant = n > 1 ? (now + 1 + Math.floor(Math.random() * (n - 1))) % n : now;
        const id = there.id;
        changeIcons(map.icons.map((i) => (i.id === id ? { ...i, variant } : i)));
        setSelectedIcon(id);
        return;
      }
      // Mountains, hills and volcanoes are sized by their polygon, around the width set in the panel.
      const size = Math.max(0.05, (iconSettings.sizeKm / kmPerUnit) * (SIZED_BY_POLYGON.has(iconKind) ? polygonScale(graph)[c] : 1));
      const icon: PlacedIcon = {
        id: newId(),
        kind: iconKind,
        x: graph.centers[c * 2],
        y: graph.centers[c * 2 + 1] + footOffset(iconKind, size, graph.spacing),
        size,
        variant: Math.floor(Math.random() * variantsOf(iconKind)),
      };
      if (iconSettings.meters !== undefined && KINDS[iconKind].meters) icon.meters = iconSettings.meters;
      if (KINDS[iconKind].directional) icon.angle = iconSettings.angle ?? 180;
      if (KINDS[iconKind].group === 'settlements') icon.color = iconSettings.color ?? DEFAULT_ROOF;
      const replaced = there?.id;
      changeIcons([...(replaced ? map.icons.filter((i) => i.id !== replaced) : map.icons), icon]);
      setSelectedIcon(icon.id);
    },
    [graph, iconKind, iconSettings, kmPerUnit, map.icons, changeIcons],
  );

  /** Takes over an icon the app drew by itself: it becomes an icon placed by hand, in the same spot, and the app's copy is left out. */
  const adoptIcon = useCallback(
    (p: Placement, meters: number) => {
      const icon: PlacedIcon = { id: newId(), kind: p.set, x: p.x, y: p.y, size: p.size, variant: p.variant };
      // A hill or mountain keeps the height of the ground it stood on, so taking it over does not raise the land.
      if (KINDS[p.set].meters) icon.meters = Math.max(1, Math.round(meters));
      // A waterfall the app drew keeps the direction it fell.
      if (KINDS[p.set].directional) icon.angle = p.angle ?? 180;
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
    ? { sizeKm: selected.size * kmPerUnit, meters: selected.meters ?? KINDS[selected.kind].meters?.value, angle: selected.angle ?? (KINDS[selected.kind].directional ? 180 : undefined), color: KINDS[selected.kind].group === 'settlements' ? (selected.color ?? DEFAULT_ROOF) : undefined }
    : null;
  const editSelected = (s: IconSettings) => {
    if (!selected) return;
    const next: PlacedIcon = { ...selected, size: Math.max(0.05, s.sizeKm / kmPerUnit) };
    if (KINDS[selected.kind].meters && s.meters !== undefined) next.meters = s.meters;
    if (KINDS[selected.kind].directional) next.angle = s.angle ?? 180;
    if (KINDS[selected.kind].group === 'settlements') next.color = s.color ?? DEFAULT_ROOF;
    changeIcons(
      map.icons.map((i) => (i.id === selected.id ? next : i)),
      `edit ${selected.id}`,
    );
  };

  // ------------------------------------------------------------ rivers

  const [riverTool, setRiverTool] = useState<RiverTool>('draw');
  const [selectedRiver, setSelectedRiver] = useState<string | null>(null);
  const [newRiverKm, setNewRiverKm] = useState(() => Math.round(defaultRiverWidth(graph.spacing) * kmPerUnit * 10) / 10);
  const river = selectedRiver ? (map.rivers.find((r) => r.id === selectedRiver) ?? null) : null;
  useEffect(() => {
    if (selectedRiver && !river) setSelectedRiver(null);
  }, [selectedRiver, river]);
  useEffect(() => {
    if (mode !== 'rivers') setSelectedRiver(null);
  }, [mode]);

  /** Changes the rivers and adds the change to the undo history. */
  const changeRivers = useCallback(
    (next: River[], key?: string) => {
      const before = map.rivers;
      setRivers(next);
      painter.push({ undo: () => setRivers(before), redo: () => setRivers(next), key });
    },
    [map.rivers, painter],
  );
  const addRiver = useCallback(
    (vertices: number[]) => {
      const r: River = { id: newId(), vertices, width: Math.max(0.01, newRiverKm / kmPerUnit) };
      changeRivers([...map.rivers, r]);
      setSelectedRiver(r.id);
    },
    [map.rivers, changeRivers, newRiverKm, kmPerUnit],
  );
  const deleteRiver = useCallback(() => {
    if (!selectedRiver) return;
    changeRivers(map.rivers.filter((r) => r.id !== selectedRiver));
    setSelectedRiver(null);
  }, [selectedRiver, map.rivers, changeRivers]);
  const riverLengthKm = river ? riverLength(graph, river) * kmPerUnit : 0;

  // ------------------------------------------------------------ cliffs

  const [cliffTool, setCliffTool] = useState<CliffTool>('draw');
  const [selectedCliff, setSelectedCliff] = useState<string | null>(null);
  const [newCliffMeters, setNewCliffMeters] = useState(300);
  const cliff = selectedCliff ? (map.cliffs.find((c) => c.id === selectedCliff) ?? null) : null;
  useEffect(() => {
    if (selectedCliff && !cliff) setSelectedCliff(null);
  }, [selectedCliff, cliff]);
  useEffect(() => {
    if (mode !== 'cliffs') setSelectedCliff(null);
  }, [mode]);
  /** Changes the cliffs and adds the change to the undo history. */
  const changeCliffs = useCallback(
    (next: Cliff[], key?: string) => {
      const before = map.cliffs;
      setCliffs(next);
      painter.push({ undo: () => setCliffs(before), redo: () => setCliffs(next), key });
    },
    [map.cliffs, painter],
  );
  const addCliff = useCallback(
    (vertices: number[]) => {
      const c: Cliff = { id: newId(), vertices, meters: newCliffMeters };
      changeCliffs([...map.cliffs, c]);
      setSelectedCliff(c.id);
    },
    [map.cliffs, changeCliffs, newCliffMeters],
  );
  const deleteCliff = useCallback(() => {
    if (!selectedCliff) return;
    changeCliffs(map.cliffs.filter((c) => c.id !== selectedCliff));
    setSelectedCliff(null);
  }, [selectedCliff, map.cliffs, changeCliffs]);
  const cliffLengthKm = cliff ? cliffLength(graph, cliff) * kmPerUnit : 0;

  // ------------------------------------------------------------ map text (Stage 8)

  const [textTool, setTextTool] = useState<TextTool>('add');
  const [textKind, setTextKind] = useState<TextKind>('region');
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const textItem = selectedText ? (map.texts.find((t) => t.id === selectedText) ?? null) : null;
  useEffect(() => {
    if (selectedText && !textItem) setSelectedText(null);
  }, [selectedText, textItem]);
  useEffect(() => {
    if (mode !== 'text') setSelectedText(null);
  }, [mode]);
  /** Changes the map's text and adds the change to the undo history (changes with the same key less than a second apart are one step). */
  const changeTexts = useCallback(
    (next: MapText[], key?: string) => {
      const before = map.texts;
      setTexts(next);
      painter.push({ undo: () => setTexts(before), redo: () => setTexts(next), key });
    },
    [map.texts, painter],
  );
  const addText = useCallback(
    (x: number, y: number, curve?: [number, number][]) => {
      const t: MapText = { id: newId(), kind: textKind, text: TEXT_STYLES[textKind].label, x, y };
      if (curve) t.curve = curve;
      changeTexts([...map.texts, t]);
      setSelectedText(t.id);
    },
    [map.texts, changeTexts, textKind],
  );
  const patchText = useCallback(
    (patch: Partial<MapText>, key?: string) => {
      if (!selectedText) return;
      changeTexts(
        map.texts.map((t) => (t.id === selectedText ? { ...t, ...patch } : t)),
        key,
      );
    },
    [selectedText, map.texts, changeTexts],
  );
  const deleteText = useCallback(() => {
    if (!selectedText) return;
    changeTexts(map.texts.filter((t) => t.id !== selectedText));
    setSelectedText(null);
  }, [selectedText, map.texts, changeTexts]);

  // ------------------------------------------------------------ nodes (Stage 8)

  const [selectedNode, setSelectedNode] = useState<NodeTarget | null>(null);
  const nodeExists = selectedNode ? (selectedNode.kind === 'icon' ? map.icons.some((i) => i.id === selectedNode.id) : map.texts.some((t) => t.id === selectedNode.id)) : false;
  useEffect(() => {
    if (selectedNode && !nodeExists) setSelectedNode(null);
  }, [selectedNode, nodeExists]);
  useEffect(() => {
    if (mode !== 'nodes') setSelectedNode(null);
  }, [mode]);
  /** Links the picked icon or text to an entry (or unlinks it), as one undo step. */
  const setNodeEntry = useCallback(
    (t: NodeTarget, entry: string | undefined) => {
      const put = <T extends { id: string; entry?: string }>(x: T): T => {
        if (x.id !== t.id) return x;
        const n = { ...x };
        if (entry) n.entry = entry;
        else delete n.entry;
        return n;
      };
      if (t.kind === 'icon') changeIcons(map.icons.map(put));
      else changeTexts(map.texts.map(put));
    },
    [map.icons, map.texts, changeIcons, changeTexts],
  );

  // Coming from an entry's "Show on the map": the map centered on that node, picked in Nodes mode.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const focus = (location.state as { focus?: { x: number; y: number; node?: NodeTarget } } | null)?.focus;
    if (!focus || !active) return;
    setMode('nodes');
    if (focus.node) setSelectedNode(focus.node);
    // After the mode's layout has settled.
    requestAnimationFrame(() => canvas.current?.focus(focus.x, focus.y));
    navigate(location.pathname, { replace: true, state: null });
  }, [location.key, location.state, location.pathname, active, navigate]);

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
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a field are the field's (sliders, checkboxes and buttons do not take typing).
      if (e.target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'color'].includes(e.target.type)) return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
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
      } else if (mode === 'rivers' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteRiver();
      } else if (mode === 'cliffs' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteCliff();
      } else if (mode === 'text' && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteText();
      } else if (e.key === 'Escape') {
        setSelectedIcon(null);
        setSelectedRiver(null);
        setSelectedCliff(null);
        setSelectedText(null);
        setSelectedNode(null);
      }
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
  }, [painter, mode, deleteSelected, deleteRiver, deleteCliff, deleteText, active]);

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
              { value: 'rivers', label: 'Rivers' },
              { value: 'cliffs', label: 'Cliffs' },
              { value: 'icons', label: 'Icons' },
              { value: 'text', label: 'Text' },
              { value: 'nodes', label: 'Nodes' },
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
          {mode === 'rivers' ? (
            <>
              <Segmented<RiverTool>
                value={riverTool}
                onChange={setRiverTool}
                size="sm"
                options={[
                  { value: 'draw', label: 'Draw', title: 'Drag to draw a river from its source to its mouth' },
                  { value: 'route', label: 'Route downhill', title: 'Click where a river starts: the app runs it downhill' },
                  { value: 'select', label: 'Select', title: 'Click a river to select it' },
                ]}
              />
              <span className="text-sm text-muted">{riverTool === 'draw' ? 'Drag from the source to the mouth.' : riverTool === 'route' ? 'Click where the river starts.' : 'Click a river to select it.'}</span>
            </>
          ) : mode === 'cliffs' ? (
            <>
              <Segmented<CliffTool>
                value={cliffTool}
                onChange={setCliffTool}
                size="sm"
                options={[
                  { value: 'draw', label: 'Draw', title: 'Drag along where a cliff runs; the drop is on the right of the way you drag' },
                  { value: 'select', label: 'Select', title: 'Click a cliff to select it' },
                ]}
              />
              <span className="text-sm text-muted">{cliffTool === 'draw' ? 'Drag along the cliff; the drop is on your right.' : 'Click a cliff to select it.'}</span>
            </>
          ) : mode === 'text' ? (
            <>
              <Segmented<TextTool>
                value={textTool}
                onChange={setTextTool}
                size="sm"
                options={[
                  { value: 'add', label: 'Add', title: 'Click to add text; drag along a line to add text that follows it' },
                  { value: 'select', label: 'Select', title: 'Click text to select it; drag it to move it' },
                ]}
              />
              <span className="text-sm text-muted">{textTool === 'add' ? 'Click to add text, or drag along a line.' : 'Click text to select it; drag to move it.'}</span>
            </>
          ) : mode === 'nodes' ? (
            <span className="text-sm text-muted">Click an icon or text to make it a node, or to see the entry it stands for.</span>
          ) : mode === 'icons' ? (
            <>
              <Segmented<IconTool>
                value={iconTool}
                onChange={setIconTool}
                size="sm"
                options={[
                  { value: 'place', label: 'Place', title: 'Click a polygon to place an icon in its middle; clicking one that has an icon gives it another drawing' },
                  { value: 'select', label: 'Select', title: 'Click any icon to select it, the ones the app drew included' },
                ]}
              />
              <span className="text-sm text-muted">{iconTool === 'place' ? 'Click a polygon to place it there; click again for another drawing.' : 'Click any icon to select, move or resize it.'}</span>
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
            rivers={map.rivers}
            riverMode={mode === 'rivers'}
            riverTool={riverTool}
            selectedRiver={selectedRiver}
            onAddRiver={addRiver}
            onSelectRiver={setSelectedRiver}
            cliffs={map.cliffs}
            cliffMode={mode === 'cliffs'}
            cliffTool={cliffTool}
            selectedCliff={selectedCliff}
            onAddCliff={addCliff}
            onSelectCliff={setSelectedCliff}
            texts={map.texts}
            textMode={mode === 'text'}
            textTool={textTool}
            selectedText={selectedText}
            onAddText={addText}
            onSelectText={setSelectedText}
            onMoveText={(id, x, y) => changeTexts(map.texts.map((t) => (t.id === id ? { ...t, x, y } : t)))}
            nodeMode={mode === 'nodes'}
            selectedNode={selectedNode}
            onPickNode={setSelectedNode}
            selectedIcon={selectedIcon}
            brush={brush}
            tool={clicking(mode) ? 'brush' : tool}
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

      {mode === 'rivers' ? (
        <RiversPanel
          tool={riverTool}
          newWidthKm={newRiverKm}
          onNewWidthKm={setNewRiverKm}
          selected={river}
          selectedLengthKm={riverLengthKm}
          kmPerUnit={kmPerUnit}
          onWidth={(km) => river && changeRivers(map.rivers.map((r) => (r.id === river.id ? { ...r, width: Math.max(0.01, km / kmPerUnit) } : r)), `width ${river.id}`)}
          onFlip={() => river && changeRivers(map.rivers.map((r) => (r.id === river.id ? { ...r, vertices: [...r.vertices].reverse() } : r)))}
          onDelete={deleteRiver}
          onDeselect={() => setSelectedRiver(null)}
        />
      ) : mode === 'cliffs' ? (
        <CliffsPanel
          tool={cliffTool}
          newMeters={newCliffMeters}
          onNewMeters={setNewCliffMeters}
          selected={cliff}
          selectedLengthKm={cliffLengthKm}
          onMeters={(m) => cliff && changeCliffs(map.cliffs.map((c) => (c.id === cliff.id ? { ...c, meters: m } : c)), `drop ${cliff.id}`)}
          onFlip={() => cliff && changeCliffs(map.cliffs.map((c) => (c.id === cliff.id ? { ...c, vertices: [...c.vertices].reverse() } : c)))}
          onDelete={deleteCliff}
          onDeselect={() => setSelectedCliff(null)}
        />
      ) : mode === 'nodes' ? (
        <NodesPanel
          world={world}
          map={map}
          target={selectedNode}
          onCreate={(kind: EntryKind, name: string) => {
            if (!selectedNode) return;
            const res = addEntry(kind, name);
            if (res.ok) setNodeEntry(selectedNode, res.value);
          }}
          onLink={(id) => selectedNode && setNodeEntry(selectedNode, id)}
          onUnlink={() => selectedNode && setNodeEntry(selectedNode, undefined)}
          onDeselect={() => setSelectedNode(null)}
        />
      ) : mode === 'text' ? (
        <TextPanel
          tool={textTool}
          kind={textKind}
          onKind={setTextKind}
          selected={textItem}
          onChange={patchText}
          onStraighten={() => {
            if (!textItem?.curve) return;
            // Straight, turned as the line ran from end to end.
            const c = textItem.curve;
            const [a, b] = [c[0], c[c.length - 1]];
            let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
            if (angle > 90) angle -= 180;
            if (angle < -90) angle += 180;
            const next: MapText = { ...textItem, angle: (Math.round(angle) + 360) % 360 };
            delete next.curve;
            changeTexts(map.texts.map((t) => (t.id === textItem.id ? next : t)));
          }}
          onDelete={deleteText}
          onDeselect={() => setSelectedText(null)}
        />
      ) : mode === 'icons' ? (
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
